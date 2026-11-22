import { z } from 'zod';

/**
 * Caixa da loja. Toda venda entra num caixa aberto: cada forma de pagamento
 * vira um lançamento. Lançamento não se altera nem se apaga; cancelar a venda
 * gera estornos, que ficam registrados.
 */

export const PAYMENT_KINDS = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
  outro: 'Outro',
} as const;
export type PaymentKind = keyof typeof PAYMENT_KINDS;

export interface PaymentMethod {
  id: string;
  name: string;
  kind: PaymentKind;
  active: boolean;
}

/** Formas de pagamento com que toda organização nasce. */
/** Formas padrão, com taxas e prazos de partida (cada loja ajusta para as da sua maquininha). */
export const DEFAULT_PAYMENT_METHODS: Array<{ name: string; kind: PaymentKind; feePct?: number; settleDays?: number }> = [
  { name: 'Dinheiro', kind: 'dinheiro' },
  { name: 'Pix', kind: 'pix' },
  { name: 'Cartão de débito', kind: 'debito', feePct: 1.5, settleDays: 1 },
  { name: 'Cartão de crédito', kind: 'credito', feePct: 3.5, settleDays: 30 },
];

export const CASH_MOVEMENT_TYPES = {
  recebimento: 'Recebimento',
  suprimento: 'Suprimento (entrada de troco)',
  sangria: 'Sangria (retirada)',
  estorno: 'Estorno',
} as const;
export type CashMovementType = keyof typeof CASH_MOVEMENT_TYPES;

const money = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v) : v),
  z.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo').max(1_000_000),
).transform((v) => Math.round(v * 100) / 100);
const positive = money.refine((v) => v > 0, 'Informe um valor maior que zero');

export const cashOpenSchema = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  /** Troco que já está na gaveta. */
  openingAmount: money,
});
export type CashOpenInput = z.infer<typeof cashOpenSchema>;

export const cashManualSchema = z.object({
  type: z.enum(['suprimento', 'sangria']),
  amount: positive,
  note: z.string().trim().min(3, 'Diga o motivo').max(200),
});
export type CashManualInput = z.infer<typeof cashManualSchema>;

export const cashCloseSchema = z.object({
  /** Dinheiro contado na gaveta. */
  countedAmount: money,
  notes: z.string().trim().max(500).nullish(),
});
export type CashCloseInput = z.infer<typeof cashCloseSchema>;

export const cashReverseSchema = z.object({
  reason: z.string().trim().min(3, 'Diga o motivo do estorno').max(200),
});
export type CashReverseInput = z.infer<typeof cashReverseSchema>;

export interface CashMovement {
  id: string;
  type: CashMovementType;
  /** Positivo entra, negativo sai (sangria e estorno). */
  amount: number;
  methodName: string | null;
  methodKind: PaymentKind | null;
  saleId: string | null;
  saleNumber: number | null;
  customerName: string | null;
  note: string | null;
  userName: string | null;
  at: string;
  /** Recebimento que já foi estornado. */
  reversed: boolean;
}

export interface CashSession {
  id: string;
  storeId: string;
  storeName: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedByName: string | null;
  openingAmount: number;
  closedAt: string | null;
  closedByName: string | null;
  /** Dinheiro que deveria estar na gaveta. */
  expectedCash: number;
  countedAmount: number | null;
  /** Contado − esperado (negativo = faltou). */
  difference: number | null;
  notes: string | null;
  /** Vendas do caixa (fora as canceladas). */
  sales: { count: number; total: number };
  /** Recebido por forma de pagamento (já descontados os estornos). */
  totals: Array<{ methodName: string; kind: PaymentKind; amount: number }>;
  received: number;
  movements: CashMovement[];
}

export interface CashSessionRow {
  id: string;
  storeName: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
  openedByName: string | null;
  received: number;
  difference: number | null;
}

