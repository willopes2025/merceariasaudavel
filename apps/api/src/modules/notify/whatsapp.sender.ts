import { Injectable, Logger } from '@nestjs/common';
import { metaProvider, testeProvider, webhookProvider, zapiProvider, type SendResult, type WaProvider } from './whatsapp.provider';

export type { SendResult } from './whatsapp.provider';

/** Quem mandou e de qual empresa (para a mensagem aparecer no atendimento). */
export interface SendMeta {
  tenantId?: string;
  author?: 'equipe' | 'ia' | 'sistema';
  userId?: string | null;
}

/**
 * Canal de WhatsApp da Mercearia: o ÚNICO ponto do sistema que manda mensagem.
 * O provedor sai do .env do servidor:
 *   Z-API (número por QR Code):  ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN
 *   API oficial (Meta):          META_WA_TOKEN, META_WA_PHONE_ID, META_WA_APP_SECRET, META_WA_VERIFY_TOKEN
 *   Webhook genérico:            WHATSAPP_WEBHOOK_URL (POST {"phone","message"})
 * Com mais de um, WHATSAPP_PROVIDER escolhe (zapi | meta | webhook). Sem nenhum, fica desligado.
 * Tudo que sai daqui também é anotado na conversa do atendimento (quem registra é o módulo de WhatsApp).
 */
@Injectable()
export class WhatsappSender {
  private readonly logger = new Logger('WhatsApp');
  readonly provider: WaProvider | null;
  /** Gancho do atendimento: anota a mensagem enviada na conversa. */
  onSent?: (phone: string, text: string, result: SendResult, meta: SendMeta) => Promise<void>;

  constructor() {
    this.provider = escolher(this.logger);
    this.logger.log(this.provider ? `envio ligado (${this.provider.kind})` : 'envio desligado');
  }

  /** Há um canal configurado e válido? A tela usa isto para oferecer (ou não) o envio. */
  get enabled(): boolean {
    return this.provider !== null;
  }

  async sendText(phone: string, message: string, meta: SendMeta = {}): Promise<SendResult> {
    if (!this.provider) return { ok: false, reason: 'WhatsApp ainda não conectado à Mercearia.', retry: false };
    const r = await this.provider.sendText(phone, message);
    if (!r.ok) this.logger.warn(`falha no envio: ${r.reason}`);
    await this.onSent?.(phone, message, r, meta).catch((e) => this.logger.warn(`não anotou na conversa: ${(e as Error).message}`));
    return r;
  }
}

function escolher(log: Logger): WaProvider | null {
  const env = (k: string) => process.env[k]?.trim() || undefined;
  if (process.env.WIDEZAP_WEBHOOK_URL) log.warn('WIDEZAP_WEBHOOK_URL não é mais usada. Pode apagar essa linha do .env.');
  const opcoes: Record<string, () => WaProvider | null> = {
    teste: () => testeProvider(),
    zapi: () => (env('ZAPI_INSTANCE_ID') && env('ZAPI_TOKEN') ? zapiProvider(env('ZAPI_INSTANCE_ID')!, env('ZAPI_TOKEN')!, env('ZAPI_CLIENT_TOKEN')) : null),
    meta: () => (env('META_WA_TOKEN') && env('META_WA_PHONE_ID') ? metaProvider(env('META_WA_TOKEN')!, env('META_WA_PHONE_ID')!) : null),
    webhook: () => {
      const url = validUrl(env('WHATSAPP_WEBHOOK_URL'));
      if (env('WHATSAPP_WEBHOOK_URL') && !url) log.error('WHATSAPP_WEBHOOK_URL não é uma URL http(s) válida.');
      return url ? webhookProvider(url) : null;
    },
  };
  const pedido = env('WHATSAPP_PROVIDER')?.toLowerCase();
  if (pedido) {
    const p = opcoes[pedido]?.() ?? null;
    if (!p) log.error(`WHATSAPP_PROVIDER=${pedido}, mas faltam as chaves desse provedor no .env. O WhatsApp fica DESLIGADO.`);
    return p;
  }
  return opcoes.zapi!() ?? opcoes.meta!() ?? opcoes.webhook!();
}

function validUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
