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
  /** Categoria antiga: ainda aceita; a conta do plano de contas tem preferência. */
  category: z.enum(Object.keys(PAYABLE_CATEGORIES) as [PayableCategory, ...PayableCategory[]]).default('outros'),
  /** Conta do plano de contas. */
  chartAccountId: z.string().uuid().nullish(),
  supplierId: z.string().uuid().nullish(),
  employeeId: z.string().uuid().nullish(),
  /** Mês/dia a que a despesa pertence (competência). Vazio = o vencimento. */
  competence: isoDate.nullish(),
  /** Número da nota, boleto ou documento. */
  document: z.string().trim().max(60).nullish(),
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
  /** Conta financeira de onde saiu o dinheiro (lança no extrato). */
  accountId: z.string().uuid().nullish(),
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
  chartAccountId?: string | null;
  chartAccount?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
  competence?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  document?: string | null;
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
  /** Conta onde caiu (padrão: a conta da forma de pagamento). */
  accountId: z.string().uuid().nullish(),
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
  chartAccountId: z.string().uuid().nullish(),
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
  accountId: string | null;
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
        accountId: z.string().uuid().nullish(),
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
  level: 0 | 1 | 2 | 3;
  /** Sinal de exibição: receita (+) ou dedução/despesa (−). */
  sign: 1 | -1;
  /** Valor por coluna (total e cada canal). */
  values: Record<string, number>;
  /** Linha rateada entre os canais (não é custo direto do canal). */
  allocated?: boolean;
  /** Linha de que esta é um detalhamento (abre/fecha na tela). */
  parent?: string;
  /** Código no plano de contas. */
  code?: string;
  /** Conta do plano: dá para abrir os lançamentos. */
  accountId?: string;
  /** Calculada pelas vendas (não vem de lançamento). */
  auto?: boolean;
}

export interface DreEntry {
  id: string;
  kind: 'pagar' | 'receber';
  date: string;
  description: string;
  who: string | null;
  amount: number;
  status: string;
}

// ───────────── Plano de contas e contas financeiras ─────────────

export const DRE_GROUPS = {
  receita: 'Receitas',
  deducao: 'Deduções da receita',
  custo: 'Custos',
  despesa_venda: 'Despesas de venda',
  despesa_operacional: 'Despesas operacionais',
  financeira_receita: 'Receitas financeiras',
  financeira_despesa: 'Despesas financeiras',
  imposto_lucro: 'Impostos sobre o lucro',
  fora: 'Fora do resultado (investimentos, empréstimos, sócios)',
} as const;
export type DreGroup = keyof typeof DRE_GROUPS;

export interface ChartAccount {
  id: string;
  code: string;
  name: string;
  dreLine: DreGroup;
  cashOnly: boolean;
  active: boolean;
  /** Tem contas abaixo (não recebe lançamento). */
  group: boolean;
  entries: number;
}

export const chartAccountSchema = z.object({
  code: z.string().trim().regex(/^\d{1,2}(\.\d{1,2}){0,3}$/, 'Código no formato 5.1.2'),
  name: z.string().trim().min(2, 'Dê um nome à conta').max(80),
  dreLine: z.enum(Object.keys(DRE_GROUPS) as [DreGroup, ...DreGroup[]]),
  cashOnly: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type ChartAccountInput = z.infer<typeof chartAccountSchema>;

/** Plano padrão de uma mercearia (ponto de partida; cada loja edita o seu). */
export const DEFAULT_CHART: Array<{ code: string; name: string; dreLine: DreGroup; cashOnly?: boolean }> = [
  { code: '1', name: 'Receitas', dreLine: 'receita' },
  { code: '1.3', name: 'Outras receitas operacionais', dreLine: 'receita' },
  { code: '1.4', name: 'Bonificações de fornecedores', dreLine: 'receita' },
  { code: '2', name: 'Deduções da receita', dreLine: 'deducao' },
  { code: '2.6', name: 'Impostos sobre vendas (Simples, ICMS)', dreLine: 'deducao' },
  { code: '2.7', name: 'Devoluções e reembolsos a clientes', dreLine: 'deducao' },
  { code: '3', name: 'Custos', dreLine: 'custo' },
  { code: '3.2', name: 'Compra de mercadorias para revenda', dreLine: 'custo', cashOnly: true },
  { code: '3.3', name: 'Compra de insumos e embalagens', dreLine: 'custo', cashOnly: true },
  { code: '3.5', name: 'Frete sobre compras', dreLine: 'custo' },
  { code: '4', name: 'Despesas de venda', dreLine: 'despesa_venda' },
  { code: '4.2', name: 'Pagamento de comissão a parceiros', dreLine: 'despesa_venda', cashOnly: true },
  { code: '4.4', name: 'Marketing e anúncios', dreLine: 'despesa_venda' },
  { code: '4.5', name: 'Entregas (motoboy, frete de venda)', dreLine: 'despesa_venda' },
  { code: '4.6', name: 'Embalagens de venda e delivery', dreLine: 'despesa_venda' },
  { code: '4.7', name: 'Mensalidade de marketplaces e apps', dreLine: 'despesa_venda' },
  { code: '5', name: 'Despesas operacionais', dreLine: 'despesa_operacional' },
  { code: '5.1', name: 'Pessoal', dreLine: 'despesa_operacional' },
  { code: '5.1.1', name: 'Salários', dreLine: 'despesa_operacional' },
  { code: '5.1.2', name: 'Pró-labore', dreLine: 'despesa_operacional' },
  { code: '5.1.3', name: 'Encargos (FGTS, INSS)', dreLine: 'despesa_operacional' },
  { code: '5.1.4', name: 'Benefícios (vale-transporte, alimentação)', dreLine: 'despesa_operacional' },
  { code: '5.1.5', name: 'Comissões e premiações da equipe', dreLine: 'despesa_operacional' },
  { code: '5.1.6', name: 'Férias, 13º e rescisões', dreLine: 'despesa_operacional' },
  { code: '5.2', name: 'Ocupação', dreLine: 'despesa_operacional' },
  { code: '5.2.1', name: 'Aluguel e condomínio', dreLine: 'despesa_operacional' },
  { code: '5.2.2', name: 'Energia elétrica', dreLine: 'despesa_operacional' },
  { code: '5.2.3', name: 'Água e esgoto', dreLine: 'despesa_operacional' },
  { code: '5.2.4', name: 'IPTU e taxas do imóvel', dreLine: 'despesa_operacional' },
  { code: '5.3', name: 'Administrativas', dreLine: 'despesa_operacional' },
  { code: '5.3.1', name: 'Contabilidade e jurídico', dreLine: 'despesa_operacional' },
  { code: '5.3.2', name: 'Sistemas, internet e telefonia', dreLine: 'despesa_operacional' },
  { code: '5.3.3', name: 'Manutenção e equipamentos', dreLine: 'despesa_operacional' },
  { code: '5.3.4', name: 'Limpeza e material de escritório', dreLine: 'despesa_operacional' },
  { code: '5.3.5', name: 'Taxas, alvarás e licenças', dreLine: 'despesa_operacional' },
  { code: '5.3.6', name: 'Seguros', dreLine: 'despesa_operacional' },
  { code: '5.3.9', name: 'Outras despesas', dreLine: 'despesa_operacional' },
  { code: '6', name: 'Resultado financeiro', dreLine: 'financeira_despesa' },
  { code: '6.1', name: 'Receitas financeiras (rendimentos, juros recebidos)', dreLine: 'financeira_receita' },
  { code: '6.2', name: 'Despesas financeiras', dreLine: 'financeira_despesa' },
  { code: '6.2.1', name: 'Tarifas bancárias', dreLine: 'financeira_despesa' },
  { code: '6.2.2', name: 'Juros e multas pagos', dreLine: 'financeira_despesa' },
  { code: '6.2.3', name: 'Antecipação de recebíveis', dreLine: 'financeira_despesa' },
  { code: '7', name: 'Impostos sobre o lucro', dreLine: 'imposto_lucro' },
  { code: '7.1', name: 'IRPJ e CSLL', dreLine: 'imposto_lucro' },
  { code: '8', name: 'Fora do resultado', dreLine: 'fora' },
  { code: '8.1', name: 'Investimentos (máquinas, reforma, móveis)', dreLine: 'fora' },
  { code: '8.2', name: 'Empréstimos e financiamentos (parcelas)', dreLine: 'fora' },
  { code: '8.3', name: 'Retirada e distribuição de lucros', dreLine: 'fora' },
  { code: '8.4', name: 'Aporte dos sócios', dreLine: 'fora' },
];

/** Categoria antiga das contas a pagar → conta do plano padrão. */
export const CATEGORY_TO_CHART: Record<PayableCategory, string> = {
  fornecedor: '3.2',
  insumos: '3.3',
  aluguel: '5.2.1',
  folha: '5.1.1',
  impostos: '2.6',
  marketing: '4.4',
  servicos: '5.3.2',
  outros: '5.3.9',
};

export const ACCOUNT_KINDS = { caixa: 'Caixa (dinheiro)', banco: 'Conta bancária', carteira: 'Carteira digital / maquininha' } as const;
export type AccountKind = keyof typeof ACCOUNT_KINDS;

export interface FinancialAccount {
  id: string;
  name: string;
  kind: AccountKind;
  bank: string | null;
  agency: string | null;
  number: string | null;
  pixKey: string | null;
  openingBalance: number;
  openingDate: string;
  active: boolean;
  balance: number;
}

export const financialAccountSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome à conta').max(60),
  kind: z.enum(['caixa', 'banco', 'carteira']).default('banco'),
  bank: z.string().trim().max(60).nullish(),
  agency: z.string().trim().max(20).nullish(),
  number: z.string().trim().max(30).nullish(),
  pixKey: z.string().trim().max(120).nullish(),
  openingBalance: z.preprocess((v) => (typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v || 0) : v), z.number().min(-100_000_000).max(100_000_000)).default(0),
  openingDate: isoDate.optional(),
  active: z.boolean().default(true),
});
export type FinancialAccountInput = z.infer<typeof financialAccountSchema>;

export interface AccountEntry {
  id: string;
  date: string;
  amount: number;
  kind: 'pagamento' | 'recebimento' | 'transferencia' | 'ajuste';
  description: string;
  balance: number;
  manual: boolean;
}

export const accountMoveSchema = z.object({
  /** transferencia (entre contas) | ajuste (acerta o saldo: tarifa, rendimento, diferença). */
  kind: z.enum(['transferencia', 'ajuste']),
  accountId: z.string().uuid(),
  toAccountId: z.string().uuid().optional(),
  /** Transferência: valor positivo. Ajuste: positivo entra, negativo sai. */
  amount: z.preprocess((v) => (typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v) : v), z.number().min(-100_000_000).max(100_000_000)).refine((v) => v !== 0, 'Informe o valor'),
  date: isoDate,
  description: z.string().trim().max(150).default(''),
});
export type AccountMoveInput = z.infer<typeof accountMoveSchema>;

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
  .object({ from: isoDate, to: isoDate, opening: z.coerce.number().min(-100_000_000).max(100_000_000).optional() })
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
  /** O saldo inicial veio das contas financeiras cadastradas. */
  openingFromAccounts: boolean;
  days: CashflowDay[];
  totals: { in: number; out: number; net: number };
  overdue: { receivables: number; payables: number };
}

export const payableClassifySchema = z.object({ chartAccountId: z.string().uuid().nullish(), supplierId: z.string().uuid().nullish(), competence: isoDate.nullish(), document: z.string().trim().max(60).nullish() });
export const dreEntriesQuery = z.object({ accountId: z.string().uuid(), from: isoDate, to: isoDate, view: z.enum(['competencia', 'caixa']).default('competencia') });
export const statementQuery = z.object({ from: isoDate, to: isoDate });
