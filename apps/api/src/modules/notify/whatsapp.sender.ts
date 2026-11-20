import { Injectable, Logger } from '@nestjs/common';

export type SendResult = { ok: true } | { ok: false; reason: string; retry: boolean };

/**
 * Canal de saída de WhatsApp do Mercearia. É o ÚNICO ponto do sistema que manda
 * mensagem: avisos de etapa da O.S. e orçamentos passam por aqui.
 *
 * Estado atual: DESLIGADO por padrão. O Mercearia ainda não tem WhatsApp próprio
 * (entra na Fase 6, ou antes com um número por QR Code). Enquanto estiver
 * desligado, nada é enviado, a tela não oferece envio e os avisos ficam
 * registrados como "não enviado".
 *
 * Para ligar sem esperar a Fase 6, existe um provedor genérico por webhook:
 *   WHATSAPP_WEBHOOK_URL=https://...   (recebe POST {"phone":"5527...","message":"..."})
 * Qualquer serviço que aceite esse POST serve (Make, n8n, Evolution com ponte).
 * Quando o WhatsApp próprio entrar, ele vira outro provedor AQUI, e o resto do
 * sistema não muda.
 */
@Injectable()
export class WhatsappSender {
  private readonly logger = new Logger('WhatsApp');
  private readonly url = validUrl(process.env.WHATSAPP_WEBHOOK_URL);

  constructor() {
    const raw = process.env.WHATSAPP_WEBHOOK_URL;
    if (raw && !this.url) this.logger.error('WHATSAPP_WEBHOOK_URL não é uma URL http(s) válida. O envio de WhatsApp fica DESLIGADO.');
    if (process.env.WIDEZAP_WEBHOOK_URL) this.logger.warn('WIDEZAP_WEBHOOK_URL não é mais usada. Pode apagar essa linha do .env.');
    this.logger.log(this.url ? 'envio ligado (webhook)' : 'envio desligado');
  }

  /** Há um canal configurado e válido? A tela usa isto para oferecer (ou não) o envio. */
  get enabled(): boolean {
    return this.url !== null;
  }

  async sendText(phone: string, message: string): Promise<SendResult> {
    if (!this.url) return { ok: false, reason: 'WhatsApp ainda não conectado ao Mercearia.', retry: false };
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\D/g, ''), message }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (res.ok && data.success !== false) return { ok: true };
      const detail = (data.error ?? `HTTP ${res.status}`).slice(0, 200);
      // Erro do servidor de lá: vale tentar de novo. Recusa (4xx): não adianta insistir.
      return { ok: false, reason: `O canal de WhatsApp recusou: ${detail}`, retry: res.status >= 500 };
    } catch (e) {
      this.logger.warn(`falha no envio: ${(e as Error).message}`);
      return { ok: false, reason: 'Canal de WhatsApp fora do ar ou lento.', retry: true };
    }
  }
}

function validUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
