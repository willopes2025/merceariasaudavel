import { z } from 'zod';

/**
 * Pagamento online: Pix (QR na tela) e cartão (checkout do Mercado Pago) no app,
 * Pix no totem. Pago e confirmado pelo provedor, o pedido vira venda e entra
 * na fila sozinho, sem passar no caixa.
 */
export const ONLINE_METHODS = { pix: 'Pix', cartao: 'Cartão' } as const;
export type OnlineMethod = keyof typeof ONLINE_METHODS;

export const ONLINE_STATUS = {
  pendente: 'Esperando o pagamento',
  pago: 'Pago',
  cancelado: 'Cancelado',
  expirado: 'Expirou',
  estornado: 'Devolvido',
  divergente: 'Valor diferente: confira',
} as const;
export type OnlineStatus = keyof typeof ONLINE_STATUS;

export const onlinePayStartSchema = z.object({ method: z.enum(['pix', 'cartao']) });
export type OnlinePayStartInput = z.infer<typeof onlinePayStartSchema>;

export interface OnlinePaymentView {
  id: string;
  orderId: string;
  method: OnlineMethod;
  status: OnlineStatus;
  amount: number;
  /** Pix copia e cola. */
  qrCode: string | null;
  /** QR em PNG (base64, sem o prefixo data:). */
  qrImage: string | null;
  /** Cartão: página de pagamento do provedor. */
  checkoutUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
  /** Provedor de teste (nada é cobrado de verdade). */
  test: boolean;
}

export const onlineSettingsSchema = z.object({
  onlinePix: z.boolean(),
  onlineCard: z.boolean(),
  onlineTotem: z.boolean(),
});
export type OnlineSettingsInput = z.infer<typeof onlineSettingsSchema>;

export interface OnlineSettings extends OnlineSettingsInput {
  /** Provedor ligado no servidor (.env). */
  provider: 'mercadopago' | 'teste' | null;
  /** Chave de teste do Mercado Pago (TEST-...) ou provedor de teste. */
  testMode: boolean;
  /** Endereço para colar no Mercado Pago (Webhooks). */
  webhookUrl: string | null;
  /** Aviso do Mercado Pago assinado (segredo configurado). */
  webhookSigned: boolean;
}
