import { Injectable } from '@nestjs/common';
import type { FiscalEnvironment } from '@mercearia/contracts';

/** Resposta da Focus NFe (consulta/emissão/cancelamento de NFC-e). */
export interface FocusBody {
  status?: string;
  status_sefaz?: string;
  mensagem_sefaz?: string;
  chave_nfe?: string;
  numero?: string;
  serie?: string;
  caminho_xml_nota_fiscal?: string;
  caminho_danfe?: string;
  qrcode_url?: string;
  codigo?: string;
  mensagem?: string;
  erros?: Array<{ mensagem?: string; campo?: string }>;
}

export interface FocusReply {
  http: number;
  body: FocusBody;
}

export class FocusUnreachable extends Error {}

/**
 * Focus NFe: cada empresa (CNPJ) tem um token por ambiente, enviado como
 * usuário do HTTP Basic com a senha em branco. Os tokens ficam na configuração
 * fiscal de cada loja, não no .env. FOCUS_NFE_BASE_URL só existe para os testes.
 */
@Injectable()
export class FocusNfeClient {
  baseUrl(env: FiscalEnvironment): string {
    const override = process.env.FOCUS_NFE_BASE_URL?.replace(/\/$/, '');
    return override ?? (env === 'producao' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br');
  }

  /** NFC-e é síncrona: a resposta já diz se foi autorizada ou rejeitada. */
  emitNfce(token: string, env: FiscalEnvironment, ref: string, payload: unknown): Promise<FocusReply> {
    return this.call(token, env, 'POST', `/v2/nfce?ref=${encodeURIComponent(ref)}`, payload);
  }

  getNfce(token: string, env: FiscalEnvironment, ref: string): Promise<FocusReply> {
    return this.call(token, env, 'GET', `/v2/nfce/${encodeURIComponent(ref)}`);
  }

  cancelNfce(token: string, env: FiscalEnvironment, ref: string, justificativa: string): Promise<FocusReply> {
    return this.call(token, env, 'DELETE', `/v2/nfce/${encodeURIComponent(ref)}`, { justificativa });
  }

  /** Caminho de arquivo devolvido pela Focus → endereço completo. */
  fileUrl(env: FiscalEnvironment, path: string | undefined): string | null {
    if (!path) return null;
    return /^https?:\/\//.test(path) ? path : `${this.baseUrl(env)}${path}`;
  }

  private async call(token: string, env: FiscalEnvironment, method: string, path: string, body?: unknown): Promise<FocusReply> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl(env)}${path}`, {
        method,
        headers: { authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`, 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'mercearia' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(40_000),
      });
    } catch (e) {
      throw new FocusUnreachable((e as Error).message);
    }
    const data = (await res.json().catch(() => ({}))) as FocusBody;
    return { http: res.status, body: data && typeof data === 'object' ? data : {} };
  }
}

/** Mensagem legível de uma resposta de erro da Focus. */
export function focusMessage(r: FocusReply): string {
  if (r.http === 401 || r.http === 403) return 'A Focus NFe recusou o token. Confira o token e se ele é do ambiente escolhido (homologação ou produção).';
  const parts = [r.body.mensagem_sefaz, r.body.mensagem, ...(r.body.erros ?? []).map((e) => [e.campo, e.mensagem].filter(Boolean).join(': '))].filter(Boolean);
  return (parts.join(' · ') || `A Focus NFe respondeu HTTP ${r.http}.`).slice(0, 500);
}
