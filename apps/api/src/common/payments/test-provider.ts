import { randomBytes } from 'node:crypto';
import type { CheckoutRequest, PaymentProvider, PixRequest, RemotePayment, WebhookInput } from './provider';

/**
 * Provedor de teste (PAY_PROVIDER=teste): nada é cobrado. A dona aprova o
 * pagamento pelo sistema ("Simular pagamento") para ver o fluxo inteiro.
 */
export class TestProvider implements PaymentProvider {
  readonly name = 'teste' as const;
  readonly testMode = true;
  readonly webhookSigned = false;
  private readonly payments = new Map<string, RemotePayment & { refs: string[] }>();

  async createPix(req: PixRequest) {
    const ref = `T${randomBytes(6).toString('hex')}`;
    this.payments.set(ref, { paymentId: ref, status: 'pending', amount: req.amount, reference: req.reference, refs: [] });
    return { ref, qrCode: `00020126580014BR.GOV.BCB.PIX0136TESTE-${req.reference}5204000053039865406${req.amount.toFixed(2)}5802BR5909MERCEARIA6005NATAL62070503***6304TEST`, qrImage: null };
  }

  async createCheckout(req: CheckoutRequest) {
    const ref = `T${randomBytes(6).toString('hex')}`;
    this.payments.set(ref, { paymentId: ref, status: 'pending', amount: req.amount, reference: req.reference, refs: [] });
    return { ref, url: `${req.backUrl}${req.backUrl.includes('?') ? '&' : '?'}teste=1` };
  }

  async getPayment(paymentId: string) {
    return this.payments.get(paymentId) ?? null;
  }

  async findByReference(reference: string) {
    return [...this.payments.values()].filter((p) => p.reference === reference);
  }

  async cancel(paymentId: string) {
    const p = this.payments.get(paymentId);
    if (p && p.status === 'pending') p.status = 'cancelled';
  }

  async refund(paymentId: string) {
    const p = this.payments.get(paymentId);
    if (p) p.status = 'refunded';
  }

  webhookPaymentId(_: WebhookInput) {
    return null;
  }

  /** Simula o cliente pagando (o valor pode vir diferente para testar a divergência). */
  approve(ref: string, amount?: number): RemotePayment | null {
    const p = this.payments.get(ref);
    if (!p) return null;
    p.status = 'approved';
    if (amount !== undefined) p.amount = amount;
    return p;
  }
}
