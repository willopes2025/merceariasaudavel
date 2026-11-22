import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizePhone } from '@mercearia/contracts';

export type SendResult = { ok: true; externalId?: string | null } | { ok: false; reason: string; retry: boolean };

/** Mensagem que chegou, já no formato do sistema (qualquer provedor). */
export interface Inbound {
  externalId: string | null;
  /** Telefone do jeito que o provedor identifica (só dígitos). */
  phone: string;
  name: string | null;
  text: string;
  /** imagem | audio | video | documento | localizacao | figurinha | contato (quando não é texto). */
  media: string | null;
  /** Enviada pelo próprio número da loja (pelo celular ou pela API). */
  fromMe: boolean;
}

/** Atualização de entrega (Meta): mensagem que falhou depois de aceita. */
export interface StatusUpdate {
  externalId: string;
  failed: boolean;
  error: string | null;
}

export type ProviderKind = 'zapi' | 'meta' | 'webhook' | 'teste';

export interface WaProvider {
  kind: ProviderKind;
  /** Recebe mensagens (tem webhook de entrada). */
  inbound: boolean;
  /** API oficial: fora de 24 h da última mensagem da cliente, só modelo aprovado. */
  janela24h: boolean;
  sendText(phone: string, text: string): Promise<SendResult>;
  sendTemplate?(phone: string, name: string, language: string, params: string[]): Promise<SendResult>;
  parse(body: unknown): { messages: Inbound[]; statuses: StatusUpdate[] };
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const timeout = () => AbortSignal.timeout(20_000);

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: timeout() });
  return { status: res.status, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

function falha(status: number, detalhe: unknown, quem: string): SendResult {
  const d = (typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe ?? '')).slice(0, 200) || `HTTP ${status}`;
  return { ok: false, reason: `${quem} recusou: ${d}`, retry: status >= 500 || status === 429 };
}

async function seguro(fn: () => Promise<SendResult>): Promise<SendResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, reason: `Canal de WhatsApp fora do ar ou lento (${(e as Error).message.slice(0, 80)}).`, retry: true };
  }
}

/** Formato simples (Make, n8n, Widezap, testes): {"phone","name","message","id","fromMe"}. */
function parseSimples(body: unknown) {
  const lista = Array.isArray(body) ? body : [body];
  const messages: Inbound[] = [];
  for (const b of lista as Record<string, unknown>[]) {
    const phone = digits(b?.phone);
    const text = String(b?.message ?? b?.text ?? '').trim();
    if (!phone || (!text && !b?.media)) continue;
    messages.push({ externalId: b.id ? String(b.id) : null, phone, name: b.name ? String(b.name).slice(0, 80) : null, text, media: b.media ? String(b.media) : null, fromMe: b.fromMe === true });
  }
  return { messages, statuses: [] };
}

/** Z-API (número por QR Code). */
export function zapiProvider(instance: string, token: string, clientToken: string | undefined): WaProvider {
  const base = `https://api.z-api.io/instances/${encodeURIComponent(instance)}/token/${encodeURIComponent(token)}`;
  const headers: Record<string, string> = clientToken ? { 'Client-Token': clientToken } : {};
  return {
    kind: 'zapi',
    inbound: true,
    janela24h: false,
    sendText: (phone, text) =>
      seguro(async () => {
        const r = await post(`${base}/send-text`, headers, { phone: digits(phone), message: text });
        if (r.status < 300 && !r.data.error) return { ok: true, externalId: (r.data.messageId ?? r.data.id ?? null) as string | null };
        return falha(r.status, r.data.error ?? r.data.message, 'A Z-API');
      }),
    parse(body) {
      const b = (body ?? {}) as Record<string, unknown>;
      if (b.type !== 'ReceivedCallback' || b.isGroup || b.broadcast || b.isNewsletter || b.isStatusReply) return { messages: [], statuses: [] };
      const pega = (k: string) => (b[k] ?? null) as Record<string, unknown> | null;
      let text = String(pega('text')?.message ?? '').trim();
      let media: string | null = null;
      if (pega('image')) [media, text] = ['imagem', String(pega('image')?.caption ?? '')];
      else if (pega('audio')) media = 'audio';
      else if (pega('video')) [media, text] = ['video', String(pega('video')?.caption ?? '')];
      else if (pega('document')) [media, text] = ['documento', String(pega('document')?.fileName ?? '')];
      else if (pega('location')) media = 'localizacao';
      else if (pega('sticker')) media = 'figurinha';
      else if (pega('contact')) media = 'contato';
      else if (pega('buttonsResponseMessage')) text = String(pega('buttonsResponseMessage')?.message ?? '');
      else if (pega('listResponseMessage')) text = String(pega('listResponseMessage')?.title ?? '');
      const phone = digits(b.phone);
      if (!phone || (!text && !media)) return { messages: [], statuses: [] };
      return { messages: [{ externalId: b.messageId ? String(b.messageId) : null, phone, name: (b.senderName ?? b.chatName ?? null) as string | null, text, media, fromMe: b.fromMe === true }], statuses: [] };
    },
  };
}

/** API oficial do WhatsApp (Meta Cloud API). */
export function metaProvider(token: string, phoneId: string): WaProvider {
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`;
  const headers = { authorization: `Bearer ${token}` };
  const enviar = (body: Record<string, unknown>) =>
    seguro(async () => {
      const r = await post(url, headers, { messaging_product: 'whatsapp', ...body });
      const id = (r.data.messages as Array<{ id: string }> | undefined)?.[0]?.id;
      if (r.status < 300 && id) return { ok: true, externalId: id };
      const erro = r.data.error as { message?: string; error_data?: { details?: string } } | undefined;
      return falha(r.status, erro?.error_data?.details ?? erro?.message, 'O WhatsApp (Meta)');
    });
  return {
    kind: 'meta',
    inbound: true,
    janela24h: true,
    sendText: (phone, text) => enviar({ to: digits(phone), type: 'text', text: { body: text, preview_url: true } }),
    sendTemplate: (phone, name, language, params) =>
      enviar({ to: digits(phone), type: 'template', template: { name, language: { code: language }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) }] } : {}) } }),
    parse(body) {
      const messages: Inbound[] = [];
      const statuses: StatusUpdate[] = [];
      const entries = ((body as { entry?: unknown[] })?.entry ?? []) as Array<{ changes?: Array<{ value?: Record<string, unknown> }> }>;
      for (const e of entries)
        for (const c of e.changes ?? []) {
          const v = c.value ?? {};
          const nomes = new Map(((v.contacts ?? []) as Array<{ wa_id: string; profile?: { name?: string } }>).map((x) => [x.wa_id, x.profile?.name ?? null]));
          for (const m of (v.messages ?? []) as Array<Record<string, any>>) {
            const tipo = String(m.type ?? '');
            const mapa: Record<string, string> = { image: 'imagem', audio: 'audio', voice: 'audio', video: 'video', document: 'documento', location: 'localizacao', sticker: 'figurinha', contacts: 'contato' };
            const text = tipo === 'text' ? String(m.text?.body ?? '') : tipo === 'button' ? String(m.button?.text ?? '') : tipo === 'interactive' ? String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '') : String(m[tipo]?.caption ?? m[tipo]?.filename ?? '');
            const media = mapa[tipo] ?? null;
            if (!text && !media) continue;
            messages.push({ externalId: String(m.id), phone: digits(m.from), name: nomes.get(String(m.from)) ?? null, text: text.trim(), media, fromMe: false });
          }
          for (const s of (v.statuses ?? []) as Array<Record<string, any>>) {
            if (s.status === 'failed') statuses.push({ externalId: String(s.id), failed: true, error: String(s.errors?.[0]?.error_data?.details ?? s.errors?.[0]?.title ?? 'Falhou').slice(0, 300) });
          }
        }
      return { messages, statuses };
    },
  };
}

/** Confere a assinatura do webhook da Meta (X-Hub-Signature-256). */
export function metaSignatureOk(appSecret: string, raw: Buffer | undefined, header: string | undefined): boolean {
  if (!raw || !header?.startsWith('sha256=')) return false;
  const esperado = Buffer.from(createHmac('sha256', appSecret).update(raw).digest('hex'));
  const recebido = Buffer.from(header.slice(7));
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

/** Provedor genérico por webhook (POST {"phone","message"}); a entrada usa o formato simples. */
export function webhookProvider(url: string): WaProvider {
  return {
    kind: 'webhook',
    inbound: true,
    janela24h: false,
    sendText: (phone, message) =>
      seguro(async () => {
        const r = await post(url, {}, { phone: digits(phone), message });
        if (r.status < 300 && r.data.success !== false) return { ok: true, externalId: (r.data.id ?? r.data.messageId ?? null) as string | null };
        return falha(r.status, r.data.error, 'O canal de WhatsApp');
      }),
    parse: parseSimples,
  };
}

/** Provedor de teste: não manda nada para fora; guarda o que "enviou" (testes ponta a ponta). */
export function testeProvider(): WaProvider & { enviadas: Array<{ phone: string; text: string }> } {
  const enviadas: Array<{ phone: string; text: string }> = [];
  let n = 0;
  return {
    kind: 'teste',
    inbound: true,
    janela24h: process.env.WHATSAPP_TESTE_JANELA === '1',
    enviadas,
    sendText: async (phone, text) => {
      if (text.includes('[falhar]')) return { ok: false, reason: 'Falha de teste.', retry: false };
      enviadas.push({ phone: digits(phone), text });
      return { ok: true, externalId: `teste-${Date.now()}-${++n}` };
    },
    sendTemplate: async (phone, name, _lang, params) => {
      enviadas.push({ phone: digits(phone), text: `[modelo ${name}] ${params.join(' | ')}` });
      return { ok: true, externalId: `teste-${Date.now()}-${++n}` };
    },
    parse: parseSimples,
  };
}

/** Variações do mesmo celular (com e sem o 9, com e sem 55) para achar a conversa e a cliente. */
export function phoneVariants(phone: string): string[] {
  const d = digits(phone);
  const n = normalizePhone(d);
  const out = new Set([d]);
  if (n) {
    out.add(n);
    // 55 + DDD + 9 + 8 dígitos → também sem o 9 (como alguns números antigos aparecem no WhatsApp).
    if (n.length === 13) out.add(n.slice(0, 4) + n.slice(5));
  }
  return [...out];
}
