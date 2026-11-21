import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ProviderError, type CheckoutRequest, type PaymentProvider, type PixRequest, type RemotePayment, type RemoteStatus, type WebhookInput } from './provider';

const API = 'https://api.mercadopago.com';

interface MpPayment {
  id: number | string;
  status: string;
  transaction_amount: number;
  external_reference: string | null;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
}

const STATUS: Record<string, RemoteStatus> = {
  approved: 'approved',
  authorized: 'pending',
  pending: 'pending',
  in_process: 'pending',
  in_mediation: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
  refunded: 'refunded',
  charged_back: 'refunded',
};

const header = (h: WebhookInput['headers'], name: string) => {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Mercado Pago: Pix pela API de pagamentos (QR copia e cola) e cartão pelo
 * Checkout Pro (página do Mercado Pago, o cartão nunca passa por aqui).
 * O aviso (webhook) só diz o id: o status sempre vem de uma consulta à API.
 */
export class MercadoPagoProvider implements PaymentProvider {
  readonly name = 'mercadopago' as const;
  readonly testMode: boolean;
  readonly webhookSigned: boolean;

  constructor(
    private readonly token: string,
    private readonly webhookSecret: string | null,
  ) {
    this.testMode = token.startsWith('TEST-');
    this.webhookSigned = Boolean(webhookSecret);
  }

  async createPix(req: PixRequest) {
    const [first, ...rest] = req.payerName.trim().split(/\s+/);
    const body = {
      transaction_amount: req.amount,
      description: req.description.slice(0, 120),
      payment_method_id: 'pix',
      external_reference: req.reference,
      date_of_expiration: toMpDate(req.expiresAt),
      payer: { email: req.payerEmail, first_name: first ?? 'Cliente', last_name: rest.join(' ') || undefined },
      ...(req.notificationUrl ? { notification_url: req.notificationUrl } : {}),
    };
    const p = await this.call<MpPayment>('POST', '/v1/payments', body, req.reference);
    const data = p.point_of_interaction?.transaction_data;
    if (!data?.qr_code) throw new ProviderError('O Mercado Pago não devolveu o QR do Pix.');
    return { ref: String(p.id), qrCode: data.qr_code, qrImage: data.qr_code_base64 ?? null };
  }

  async createCheckout(req: CheckoutRequest) {
    const body = {
      items: [{ id: req.reference, title: req.title.slice(0, 120), quantity: 1, unit_price: req.amount, currency_id: 'BRL' }],
      external_reference: req.reference,
      back_urls: { success: req.backUrl, failure: req.backUrl, pending: req.backUrl },
      auto_return: 'approved',
      // Só cartão (Pix tem o QR na tela do app; boleto não serve para pedido na hora).
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }], installments: 1 },
      expires: true,
      expiration_date_to: toMpDate(req.expiresAt),
      statement_descriptor: 'MERCEARIA',
      ...(req.notificationUrl ? { notification_url: req.notificationUrl } : {}),
    };
    const pref = await this.call<{ id: string; init_point: string; sandbox_init_point?: string }>('POST', '/checkout/preferences', body, `pref-${req.reference}`);
    return { ref: pref.id, url: this.testMode && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point };
  }

  async getPayment(paymentId: string): Promise<RemotePayment | null> {
    if (!/^\d+$/.test(paymentId)) return null;
    try {
      return toRemote(await this.call<MpPayment>('GET', `/v1/payments/${paymentId}`));
    } catch (e) {
      if (e instanceof ProviderError && /404/.test(e.message)) return null;
      throw e;
    }
  }

  async findByReference(reference: string): Promise<RemotePayment[]> {
    const r = await this.call<{ results: MpPayment[] }>('GET', `/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(reference)}`);
    return (r.results ?? []).map(toRemote);
  }

  async cancel(paymentId: string) {
    if (!/^\d+$/.test(paymentId)) return;
    await this.call('PUT', `/v1/payments/${paymentId}`, { status: 'cancelled' });
  }

  async refund(paymentId: string) {
    await this.call('POST', `/v1/payments/${paymentId}/refunds`, {}, `refund-${paymentId}`);
  }

  webhookPaymentId({ headers, query, body }: WebhookInput): string | null {
    const b = (body ?? {}) as { type?: string; action?: string; data?: { id?: string | number } };
    const type = String(query.type ?? query.topic ?? b.type ?? '');
    if (type !== 'payment') return null;
    const id = String(query['data.id'] ?? (query.data as { id?: unknown } | undefined)?.id ?? b.data?.id ?? query.id ?? '');
    if (!/^\d+$/.test(id)) return null;
    if (this.webhookSecret) {
      const sig = header(headers, 'x-signature') ?? '';
      const requestId = header(headers, 'x-request-id') ?? '';
      const parts = Object.fromEntries(sig.split(',').map((kv) => kv.trim().split('=') as [string, string]));
      if (!parts.ts || !parts.v1) return null;
      const manifest = `id:${id};request-id:${requestId};ts:${parts.ts};`;
      const expected = createHmac('sha256', this.webhookSecret).update(manifest).digest('hex');
      const a = Buffer.from(expected);
      const given = Buffer.from(parts.v1);
      if (a.length !== given.length || !timingSafeEqual(a, given)) return null;
    }
    return id;
  }

  private async call<T>(method: string, path: string, body?: unknown, idempotency?: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          ...(method === 'POST' ? { 'x-idempotency-key': idempotency ?? randomUUID() } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new ProviderError(`Sem resposta do Mercado Pago (${(e as Error).message}).`);
    }
    const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!res.ok) throw new ProviderError(`Mercado Pago recusou (${res.status}): ${json?.message ?? 'erro desconhecido'}`);
    return json as T;
  }
}

function toRemote(p: MpPayment): RemotePayment {
  return { paymentId: String(p.id), status: STATUS[p.status] ?? 'other', amount: Number(p.transaction_amount), reference: p.external_reference ?? null };
}

/** O Mercado Pago quer a data com fuso: 2026-11-21T10:15:00.000-03:00. */
function toMpDate(d: Date): string {
  const br = new Date(d.getTime() - 3 * 3_600_000);
  return `${br.toISOString().slice(0, 23)}-03:00`;
}
