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
