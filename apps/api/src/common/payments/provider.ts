/** O que o sistema precisa de um provedor de pagamento (Mercado Pago ou o de teste). */

export type RemoteStatus = 'approved' | 'pending' | 'rejected' | 'cancelled' | 'refunded' | 'other';

export interface RemotePayment {
  /** Id do pagamento no provedor. */
  paymentId: string;
  status: RemoteStatus;
  amount: number;
  /** Nosso id (external_reference). */
  reference: string | null;
}

export interface PixRequest {
  reference: string;
  amount: number;
  description: string;
  payerEmail: string;
  payerName: string;
  expiresAt: Date;
  notificationUrl: string | null;
}

export interface CheckoutRequest {
  reference: string;
  amount: number;
  title: string;
  backUrl: string;
  expiresAt: Date;
  notificationUrl: string | null;
}

export interface WebhookInput {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
}

export interface PaymentProvider {
  readonly name: 'mercadopago' | 'teste';
  readonly testMode: boolean;
  readonly webhookSigned: boolean;
  createPix(req: PixRequest): Promise<{ ref: string; qrCode: string; qrImage: string | null }>;
  createCheckout(req: CheckoutRequest): Promise<{ ref: string; url: string }>;
  getPayment(paymentId: string): Promise<RemotePayment | null>;
  findByReference(reference: string): Promise<RemotePayment[]>;
  /** Cancela um Pix ainda não pago (melhor esforço). */
  cancel(paymentId: string): Promise<void>;
  /** Devolve o pagamento inteiro. */
  refund(paymentId: string): Promise<void>;
  /** Id do pagamento avisado (null = aviso que não interessa ou assinatura inválida). */
  webhookPaymentId(input: WebhookInput): string | null;
}

export class ProviderError extends Error {}
