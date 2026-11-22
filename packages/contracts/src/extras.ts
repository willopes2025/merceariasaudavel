import { z } from 'zod';

/** Conciliação bancária, orçamento, auditoria, comissão de vendedor, importação e disparos. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const mesRef = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido');
const valor = z.preprocess((v) => (typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v || 0) : v), z.number().min(0).max(100_000_000));

// ───────────── Conciliação bancária ─────────────

export const ofxImportSchema = z.object({ content: z.string().min(20, 'Arquivo vazio').max(5_000_000, 'Arquivo grande demais (até 5 MB)') });
export const bankLineActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('match'), entryId: z.string().uuid() }),
  /** Baixa uma conta a pagar em aberto com a data e a conta do banco. */
  z.object({ action: z.literal('pay'), payableId: z.string().uuid() }),
  /** Lança o que o sistema não conhecia: despesa/receita numa conta do plano, ou só um ajuste de saldo. */
  z.object({ action: z.literal('create'), chartAccountId: z.string().uuid().nullish(), description: z.string().trim().max(150).optional() }),
  z.object({ action: z.literal('ignore') }),
  z.object({ action: z.literal('undo') }),
]);
export type BankLineAction = z.infer<typeof bankLineActionSchema>;

export interface BankLine {
  id: string;
  date: string;
  amount: number;
  memo: string;
  status: 'pendente' | 'conciliado' | 'ignorado';
  /** Lançamento do sistema com que foi conciliada. */
  entry: { id: string; date: string; description: string } | null;
  /** Para as pendentes: lançamentos do sistema e contas em aberto com o mesmo valor. */
  entryOptions: Array<{ id: string; date: string; description: string }>;
  payableOptions: Array<{ id: string; dueDate: string; description: string }>;
}
export interface Reconciliation {
  lines: BankLine[];
  pending: number;
  matched: number;
  ignored: number;
  /** Lançamentos do sistema no período que não apareceram no banco. */
  missingInBank: Array<{ id: string; date: string; amount: number; description: string }>;
}

// ───────────── Orçamento ─────────────

export const budgetSaveSchema = z.object({
  month: mesRef,
  items: z.array(z.object({ key: z.string().min(1).max(80), amount: valor })).max(500),
  /** Repete os mesmos valores nos meses seguintes do ano. */
  copyToYearEnd: z.boolean().default(false),
});
export type BudgetSaveInput = z.infer<typeof budgetSaveSchema>;

export interface BudgetRow {
  /** Linha do DRE (acc_<id> = conta do plano). */
  key: string;
  label: string;
  code: string | null;
  /** Grupo do DRE em que a linha fica. */
  group: string;
  /** Receita soma; o resto diminui o resultado. */
  sign: 1 | -1;
  budget: number;
  actual: number;
}
export interface BudgetReport {
  month: string;
  rows: BudgetRow[];
  resultBudget: number;
  resultActual: number;
}

// ───────────── Auditoria ─────────────

export const auditQuery = z.object({
  from: isoDate,
  to: isoDate,
  userId: z.string().uuid().optional(),
  entity: z.string().max(60).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type AuditQuery = z.infer<typeof auditQuery>;
export interface AuditRow {
  id: string;
  at: string;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  data: unknown;
}
export interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  entities: string[];
  users: Array<{ id: string; name: string }>;
}

// ───────────── Comissão de vendedor ─────────────

export interface SellerCommissionRow {
  userId: string;
  name: string;
  employeeId: string | null;
  sales: number;
  total: number;
  pct: number;
  commission: number;
}

// ───────────── Importação por planilha ─────────────

export const importSchema = z.object({
  kind: z.enum(['produtos', 'clientes']),
  /** Linhas já lidas da planilha: cada uma é { coluna: valor }. */
  rows: z.array(z.record(z.string().max(500))).min(1, 'Planilha vazia').max(5000, 'Até 5.000 linhas por vez'),
  /** Só confere, não grava. */
  dryRun: z.boolean().default(true),
});
export type ImportInput = z.infer<typeof importSchema>;
export interface ImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  errors: Array<{ line: number; message: string }>;
}
export const IMPORT_COLUMNS = {
  produtos: ['nome', 'codigo', 'codigo_barras', 'categoria', 'preco', 'preco_membro', 'custo', 'estoque', 'ncm', 'unidade'],
  clientes: ['nome', 'telefone', 'email', 'cpf', 'nascimento', 'membro'],
} as const;

// ───────────── Disparos ─────────────

export const BROADCAST_SEGMENTS = {
  todos: 'Todos os clientes',
  membros: 'Membros do clube',
  nao_membros: 'Quem ainda não é membro',
  sumidos: 'Sumidos (sem comprar há X dias)',
  recentes: 'Compraram nos últimos X dias',
  aniversariantes: 'Aniversariantes do mês',
  com_cashback: 'Com cashback para usar',
} as const;
export type BroadcastSegmentKind = keyof typeof BROADCAST_SEGMENTS;

export const broadcastSegmentSchema = z.object({
  kind: z.enum(Object.keys(BROADCAST_SEGMENTS) as [BroadcastSegmentKind, ...BroadcastSegmentKind[]]),
  days: z.coerce.number().int().min(1).max(730).default(60),
  /** Só quem comprou algo desta categoria. */
  categoryId: z.string().uuid().nullish(),
});
export type BroadcastSegment = z.infer<typeof broadcastSegmentSchema>;

export const broadcastSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome ao disparo').max(80),
  /** Aceita {nome} (primeiro nome) e {cashback} (saldo). */
  message: z.string().trim().min(5, 'Escreva a mensagem').max(1500),
  segment: broadcastSegmentSchema,
});
export type BroadcastInput = z.infer<typeof broadcastSchema>;

export interface Broadcast {
  id: string;
  name: string;
  message: string;
  segment: BroadcastSegment;
  status: 'rascunho' | 'enviando' | 'concluido' | 'cancelado';
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  finishedAt: string | null;
  /** Vendas para quem recebeu, nos 7 dias depois do envio. */
  salesAfter: number;
  revenueAfter: number;
}
export interface BroadcastPreview {
  count: number;
  sample: Array<{ name: string; phone: string }>;
}
export interface AdsReport {
  rows: Array<{ source: string; campaign: string; signups: number; orders: number; revenue: number }>;
}
