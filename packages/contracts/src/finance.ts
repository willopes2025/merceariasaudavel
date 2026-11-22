import { z } from 'zod';

/** Contas a pagar e resumo do período. */

export const PAYABLE_CATEGORIES = {
  fornecedor: 'Fornecedores (mercadoria)',
  insumos: 'Insumos do preparo',
  aluguel: 'Aluguel e condomínio',
  folha: 'Salários e comissões',
  impostos: 'Impostos e taxas',
  marketing: 'Marketing',
  servicos: 'Serviços (luz, internet, sistemas)',
  outros: 'Outros',
} as const;
export type PayableCategory = keyof typeof PAYABLE_CATEGORIES;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const money = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v) : v),
  z.number({ invalid_type_error: 'Valor inválido' }).positive('Informe um valor maior que zero').max(10_000_000),
).transform((v) => Math.round(v * 100) / 100);

export const payableSchema = z.object({
  description: z.string().trim().min(2, 'Descreva a conta').max(150),
  supplier: z.string().trim().max(100).nullish(),
  category: z.enum(Object.keys(PAYABLE_CATEGORIES) as [PayableCategory, ...PayableCategory[]]),
  /** Vazio = despesa do grupo, não de uma loja. */
  storeId: z.string().uuid().nullish(),
  amount: money,
  dueDate: isoDate,
  /** Repetir todo mês por N meses (1 = só esta). */
  repeat: z.coerce.number().int().min(1).max(24).default(1),
});
export type PayableInput = z.infer<typeof payableSchema>;

export const payablePaySchema = z.object({
  paidDate: isoDate,
  note: z.string().trim().max(200).nullish(),
});

export interface Payable {
  id: string;
  description: string;
  supplier: string | null;
  category: PayableCategory;
  storeId: string | null;
  storeName: string | null;
  amount: number;
  dueDate: string;
  status: 'open' | 'paid' | 'canceled';
  overdue: boolean;
  paidDate: string | null;
  note: string | null;
}

export const payableListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['open', 'overdue', 'paid', 'canceled', 'all']).default('open'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type PayableListQuery = z.infer<typeof payableListQuery>;

export interface PayableSummary {
  openAmount: number;
  overdueAmount: number;
  next7Days: number;
}

export const reportQuery = z.object({
  from: isoDate,
  to: isoDate,
  storeId: z.string().uuid().optional(),
}).refine((r) => r.from <= r.to, { path: ['to'], message: 'A data final é antes da inicial' });
export type ReportQuery = z.infer<typeof reportQuery>;

/** Resumo do período: vendas do caixa, recebido, perdas e contas pagas. */
export interface PeriodReport {
  from: string;
  to: string;
  sales: { count: number; total: number; averageTicket: number; canceled: number; memberShare: number; memberSavings: number; grossMargin: number };
  received: { total: number; byMethod: Array<{ name: string; amount: number }> };
  bySeller: Array<{ name: string; count: number; total: number }>;
  byCategory: Array<{ name: string; total: number; margin: number }>;
  losses: { total: number; byReason: Array<{ reason: string; amount: number }> };
  cashback: { earned: number; used: number };
  payables: { paid: number; byCategory: Array<{ category: PayableCategory; amount: number }> };
  /** Recebido − pago no período. */
  result: number;
}

/** Vencimentos mensais a partir do primeiro (dia 31 vira o último dia do mês). */
export function monthlyDueDates(first: string, count: number): string[] {
  const [y, m, d] = first.split('-').map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => {
    const lastDay = new Date(Date.UTC(y, m - 1 + i + 1, 0)).getUTCDate();
    const date = new Date(Date.UTC(y, m - 1 + i, Math.min(d, lastDay)));
    return date.toISOString().slice(0, 10);
  });
}

// ───────────── Contas a receber, taxas, DRE e fluxo de caixa ─────────────

export const RECEIVABLE_STATUS = { aberto: 'A receber', recebido: 'Recebido', cancelado: 'Cancelado' } as const;
export type ReceivableStatus = keyof typeof RECEIVABLE_STATUS;

export interface Receivable {
  id: string;
  kind: 'venda' | 'estorno' | 'avulso';
  description: string;
  methodName: string | null;
  channel: string | null;
  gross: number;
  fee: number;
  net: number;
  saleDate: string;
  dueDate: string;
  status: ReceivableStatus;
  receivedDate: string | null;
  receivedAmount: number | null;
  note: string | null;
}

export interface ReceivablesSummary {
  today: number;
  next7: number;
  next30: number;
  overdue: number;
  open: number;
  feesMonth: number;
  byMethod: Array<{ name: string; open: number; overdue: number; nextDate: string | null }>;
}

export const receivableQuery = z.object({
  status: z.enum(['aberto', 'vencido', 'recebido', 'cancelado', 'todos']).default('aberto'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  methodId: z.string().uuid().optional(),
  search: z.string().max(60).optional(),
});
export type ReceivableQuery = z.infer<typeof receivableQuery>;

export const receivableSettleSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Escolha o que recebeu').max(1000),
  receivedDate: isoDate,
  /** Só com um item: valor que caiu de fato (a diferença fica registrada). */
  amount: z.preprocess((v) => (v === '' || v == null ? undefined : typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : v), z.number().min(0).max(10_000_000).optional()),
  note: z.string().trim().max(300).optional(),
});
export type ReceivableSettleInput = z.infer<typeof receivableSettleSchema>;

export const receivableManualSchema = z.object({
  description: z.string().trim().min(2, 'Descreva o recebimento').max(150),
  amount: money,
  dueDate: isoDate,
  note: z.string().trim().max(300).optional(),
});
export type ReceivableManualInput = z.infer<typeof receivableManualSchema>;

export interface PaymentMethodFees {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  feePct: number;
  feeFixed: number;
  settleDays: number;
  reconcile: boolean;
}

export const paymentFeesSchema = z.object({
  methods: z
    .array(
      z.object({
        id: z.string().uuid(),
        feePct: z.number().min(0).max(30, 'Taxa acima de 30%? Confira'),
        feeFixed: z.number().min(0).max(100),
        settleDays: z.number().int().min(0).max(365),
        reconcile: z.boolean(),
      }),
    )
    .min(1),
});
export type PaymentFeesInput = z.infer<typeof paymentFeesSchema>;

export const financeConfigSchema = z.object({
  /** Alíquota estimada de impostos sobre as vendas (ex.: Simples Nacional). 0 = usa os impostos lançados em contas a pagar. */
  impostoPct: z.number().min(0).max(40).default(0),
});
export type FinanceConfig = z.infer<typeof financeConfigSchema>;

export type DreView = 'competencia' | 'caixa';
export const dreQuery = z
  .object({ from: isoDate, to: isoDate, view: z.enum(['competencia', 'caixa']).default('competencia'), storeId: z.string().uuid().optional() })
  .refine((r) => r.from <= r.to, { path: ['to'], message: 'A data final é antes da inicial' });
export type DreQuery = z.infer<typeof dreQuery>;

export interface DreLine {
  key: string;
  label: string;
  /** 0 = resultado/subtotal, 1 = grupo, 2 = detalhe. */
  level: 0 | 1 | 2;
  /** Sinal de exibição: receita (+) ou dedução/despesa (−). */
  sign: 1 | -1;
  /** Valor por coluna (total e cada canal). */
  values: Record<string, number>;
  /** Linha rateada entre os canais (não é custo direto do canal). */
  allocated?: boolean;
}

export interface Dre {
  from: string;
  to: string;
  view: DreView;
  columns: Array<{ key: string; label: string }>;
  lines: DreLine[];
  previous: { from: string; to: string; values: Record<string, number> };
  notes: string[];
}

export const cashflowQuery = z
  .object({ from: isoDate, to: isoDate, opening: z.coerce.number().min(-100_000_000).max(100_000_000).default(0) })
  .refine((r) => r.from <= r.to, { path: ['to'], message: 'A data final é antes da inicial' });
export type CashflowQuery = z.infer<typeof cashflowQuery>;

export interface CashflowDay {
  date: string;
  inDone: number;
  inExpected: number;
  outDone: number;
  outExpected: number;
  net: number;
  balance: number;
}

export interface Cashflow {
  from: string;
  to: string;
  opening: number;
  days: CashflowDay[];
  totals: { in: number; out: number; net: number };
  overdue: { receivables: number; payables: number };
}
