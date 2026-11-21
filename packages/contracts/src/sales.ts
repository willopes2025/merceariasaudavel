import { z } from 'zod';
import type { PaymentKind } from './cash';
import { parseNumber, quantity, type ProductKind, type Unit } from './products';

/**
 * Venda no balcão (PDV). O caixa manda só produto e quantidade: preço, preço de
 * membro, desconto, cashback e total são calculados no servidor.
 */

const money = z
  .preprocess((v) => parseNumber(v) ?? 0, z.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo').max(1_000_000))
  .transform((v) => Math.round(v * 100) / 100);

export const SALE_CHANNELS = {
  loja: 'Balcão',
  ifood: 'iFood',
  whatsapp: 'WhatsApp',
  site: 'Loja online',
  app: 'Aplicativo',
  marketplace: 'Marketplace',
} as const;
export type SaleChannel = keyof typeof SALE_CHANNELS;

/** Uma linha: produto, quantidade e as opções da montagem (ids). */
export const saleLineSchema = z.object({
  productId: z.string().uuid('Produto inválido'),
  quantity: quantity(),
  options: z.array(z.string().uuid()).max(30).default([]),
});
export type SaleLineInput = z.infer<typeof saleLineSchema>;

const lines = z
  .array(saleLineSchema)
  .min(1, 'Coloque pelo menos um produto')
  .max(300);

/** Conta a venda sem gravar: o caixa mostra o que o servidor vai cobrar. */
export const saleQuoteSchema = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  customerId: z.string().uuid().nullish(),
  items: lines,
  discount: money.default(0),
  /** Quanto do cashback a cliente quer usar. */
  useCashback: money.default(0),
});
export type SaleQuoteInput = z.infer<typeof saleQuoteSchema>;

export const saleCreateSchema = saleQuoteSchema.extend({
  channel: z.enum(Object.keys(SALE_CHANNELS) as [SaleChannel, ...SaleChannel[]]).default('loja'),
  payments: z
    .array(z.object({ methodId: z.string().uuid('Escolha a forma de pagamento'), amount: money.refine((v) => v > 0, 'Valor maior que zero') }))
    .max(6),
  /** CPF na nota (quando a cliente pede e não está cadastrada). */
  cpf: z
    .string()
    .nullish()
    .transform((v) => (v ? v.replace(/\D/g, '') : null))
    .refine((v) => v === null || v.length === 11 || v.length === 14, 'CPF ou CNPJ inválido'),
  /** Emitir a NFC-e agora (quando a loja tem nota configurada). */
  emitNfce: z.boolean().default(true),
  /** Pedido do app/totem que está sendo cobrado. */
  orderId: z.string().uuid().nullish(),
  notes: z.string().trim().max(300).nullish(),
});
export type SaleCreateInput = z.infer<typeof saleCreateSchema>;

/** Escolha da montagem gravada na venda. */
export interface ChosenOption {
  id: string;
  group: string;
  name: string;
  price: number;
}

export interface SaleQuoteLine {
  productId: string;
  /** Nome do produto (as escolhas vêm em options). */
  description: string;
  options: ChosenOption[];
  kind: ProductKind;
  unit: Unit;
  quantity: number;
  listPrice: number;
  unitPrice: number;
  /** Economia do preço de membro nesta linha. */
  memberSavings: number;
  total: number;
  /** Saldo depois da venda ficaria negativo (avisa, não bloqueia). */
  stockWarning: string | null;
}

export interface SaleQuote {
  member: boolean;
  customer: { id: string; name: string; cashbackBalance: number } | null;
  items: SaleQuoteLine[];
  grossTotal: number;
  memberSavings: number;
  discount: number;
  /** Cashback efetivamente usado (limitado ao saldo e à regra). */
  cashbackUsed: number;
  /** Até quanto de cashback poderia usar nesta compra. */
  cashbackAvailable: number;
  /** A pagar em dinheiro/cartão/pix. */
  total: number;
  /** Cashback que a cliente vai ganhar. */
  cashbackEarned: number;
  /** Quanto economizaria se fosse membro (para oferecer o clube). */
  wouldSaveAsMember: number;
}

export interface SalePayment {
  id: string;
  methodName: string;
  kind: PaymentKind | null;
  amount: number;
  reversed: boolean;
}

export interface Sale {
  id: string;
  number: number;
  storeId: string;
  storeName: string;
  channel: SaleChannel;
  status: 'completed' | 'canceled';
  customerId: string | null;
  customerName: string | null;
  memberPricing: boolean;
  sellerName: string | null;
  items: Array<{ productId: string; description: string; options: ChosenOption[]; unit: Unit; quantity: number; listPrice: number; unitPrice: number; total: number }>;
  /** Pedido ligado a esta venda (app, totem ou tela de preparo). */
  order: { id: string; number: number; status: string } | null;
  grossTotal: number;
  memberSavings: number;
  discount: number;
  cashbackUsed: number;
  cashbackEarned: number;
  total: number;
  /** Troco devolvido em dinheiro. */
  change: number;
  payments: SalePayment[];
  notes: string | null;
  createdAt: string;
  canceledAt: string | null;
  cancelReason: string | null;
  /** Nota fiscal desta venda (a mais recente). */
  fiscal: { id: string; status: string; number: string | null; danfeUrl: string | null; message: string | null } | null;
}

export interface SaleRow {
  id: string;
  number: number;
  storeName: string;
  channel: SaleChannel;
  status: 'completed' | 'canceled';
  customerName: string | null;
  memberPricing: boolean;
  sellerName: string | null;
  total: number;
  itemsCount: number;
  createdAt: string;
  fiscalStatus: string | null;
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const saleListQuery = z.object({
  from: isoDay.optional(),
  to: isoDay.optional(),
  storeId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.enum(['all', 'completed', 'canceled']).default('all'),
  q: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type SaleListQuery = z.infer<typeof saleListQuery>;

export const saleCancelSchema = z.object({
  reason: z.string().trim().min(5, 'Diga o motivo do cancelamento').max(200),
});
export type SaleCancelInput = z.infer<typeof saleCancelSchema>;

/** Troco: o que passou do total só pode sair do dinheiro. */
export function changeFor(total: number, payments: Array<{ amount: number; kind: string }>): { change: number; error: string | null } {
  const c = (v: number) => Math.round(v * 100);
  const paid = payments.reduce((s, p) => s + c(p.amount), 0);
  const cash = payments.filter((p) => p.kind === 'dinheiro').reduce((s, p) => s + c(p.amount), 0);
  const due = c(total);
  if (paid < due) return { change: 0, error: `Falta receber R$ ${((due - paid) / 100).toFixed(2).replace('.', ',')}.` };
  const over = paid - due;
  if (over > cash) return { change: 0, error: 'Só pagamento em dinheiro pode passar do total (para dar troco).' };
  return { change: over / 100, error: null };
}
