import { z } from 'zod';
import { parseNumber } from './products';

/** Metas, painel do dia e telas de TV. */

export const GOAL_METRICS = {
  faturamento: { label: 'Faturamento', unit: 'R$', higherIsBetter: true },
  vendas: { label: 'Número de vendas', unit: 'vendas', higherIsBetter: true },
  ticket: { label: 'Ticket médio', unit: 'R$', higherIsBetter: true },
  itens_por_venda: { label: 'Itens por venda', unit: 'itens', higherIsBetter: true },
  novos_membros: { label: 'Novos membros do clube', unit: 'membros', higherIsBetter: true },
  perda_insumos: { label: 'Perda de insumos (máximo)', unit: '%', higherIsBetter: false },
} as const;
export type GoalMetric = keyof typeof GOAL_METRICS;

export const GOAL_SCOPES = {
  loja: 'A loja toda',
  vendedor: 'Uma pessoa da equipe',
  categoria: 'Uma categoria de produto',
  produto: 'Um produto',
} as const;
export type GoalScope = keyof typeof GOAL_SCOPES;

/** Métricas que fazem sentido em cada escopo. */
export const METRICS_BY_SCOPE: Record<GoalScope, GoalMetric[]> = {
  loja: ['faturamento', 'vendas', 'ticket', 'itens_por_venda', 'novos_membros', 'perda_insumos'],
  vendedor: ['faturamento', 'vendas', 'ticket', 'itens_por_venda', 'novos_membros'],
  categoria: ['faturamento'],
  produto: ['faturamento'],
};

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

export const goalSchema = z
  .object({
    name: z.string().trim().min(2, 'Dê um nome para a meta').max(80),
    metric: z.enum(Object.keys(GOAL_METRICS) as [GoalMetric, ...GoalMetric[]]),
    scope: z.enum(Object.keys(GOAL_SCOPES) as [GoalScope, ...GoalScope[]]),
    storeId: z
      .string()
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    /** Pessoa, categoria ou produto (conforme o escopo). */
    refId: z
      .string()
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    startDate: isoDay,
    endDate: isoDay,
    target: z.preprocess((v) => parseNumber(v), z.number({ invalid_type_error: 'Valor inválido', required_error: 'Informe o alvo' }).positive('O alvo tem que ser maior que zero').max(100_000_000)),
    active: z.boolean().default(true),
  })
  .refine((g) => g.startDate <= g.endDate, { path: ['endDate'], message: 'O fim é antes do início' })
  .refine((g) => g.scope === 'loja' || g.refId, { path: ['refId'], message: 'Escolha a pessoa, a categoria ou o produto' })
  .refine((g) => METRICS_BY_SCOPE[g.scope].includes(g.metric), { path: ['metric'], message: 'Essa métrica não se aplica a esse escopo' });
export type GoalInput = z.infer<typeof goalSchema>;

/** verde = no ritmo ou batida; amarelo = um pouco atrás; vermelho = longe do ritmo. */
export type GoalStatus = 'green' | 'yellow' | 'red';

export interface Goal {
  id: string;
  name: string;
  metric: GoalMetric;
  scope: GoalScope;
  storeId: string | null;
  storeName: string | null;
  refId: string | null;
  refName: string | null;
  startDate: string;
  endDate: string;
  target: number;
  active: boolean;
  progress: {
    actual: number;
    /** actual ÷ target. */
    pct: number;
    /** Quanto do período já passou (0–1). */
    elapsed: number;
    status: GoalStatus;
    /** Faturamento/vendas: quanto falta por dia até o fim. */
    perDayNeeded: number | null;
    /** No ritmo atual, onde termina. */
    projection: number | null;
  };
}

export const goalListQuery = z.object({
  status: z.enum(['current', 'all']).default('current'),
});

// ------------------------------------------------------------- painel

export interface DashboardKpis {
  total: number;
  count: number;
  ticket: number;
  itemsPerSale: number;
  /** % do faturamento que veio de membros. */
  memberShare: number;
  newMembers: number;
  cashbackEarned: number;
}

export interface Dashboard {
  storeId: string | null;
  day: string;
  today: DashboardKpis;
  /** Mesmo dia da semana passada até a mesma hora (para comparar). */
  lastWeek: DashboardKpis;
  byHour: Array<{ hour: number; total: number; count: number }>;
  month: { total: number; count: number; target: number | null; projection: number; daysLeft: number };
  topProducts: Array<{ productId: string; name: string; quantity: number; unit: string; total: number }>;
  sellers: Array<{ userId: string; name: string; total: number; count: number }>;
  goals: Goal[];
  alerts: {
    lowStock: Array<{ productId: string; name: string; quantity: number; minStock: number; unit: string }>;
    expiring: Array<{ productId: string; name: string; lotCode: string; expiresAt: string; daysLeft: number; quantity: number; value: number }>;
    /** Perda lançada no mês, a custo. */
    monthLosses: number;
    cashOpen: boolean;
  };
}

// ------------------------------------------------------------- TV

export const TV_MODES = {
  equipe: 'Equipe (metas, ranking e vendas do dia)',
  cliente: 'Clientes (ofertas de membro e QR do clube)',
} as const;
export type TvMode = keyof typeof TV_MODES;

export const tvScreenSchema = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  name: z.string().trim().min(2, 'Dê um nome (ex.: TV do balcão)').max(60),
  mode: z.enum(['equipe', 'cliente']).default('equipe'),
  active: z.boolean().default(true),
});
export type TvScreenInput = z.infer<typeof tvScreenSchema>;

export interface TvScreen {
  id: string;
  storeId: string;
  storeName: string;
  name: string;
  mode: TvMode;
  active: boolean;
  /** Caminho do link (o endereço completo é montado na tela). */
  path: string;
}

/** O que a TV mostra. Público (só com o token do link) e sem dado pessoal de cliente. */
export interface TvData {
  name: string;
  storeName: string;
  mode: TvMode;
  now: string;
  today: { total: number; count: number; ticket: number; memberShare: number };
  dayTarget: number | null;
  month: { total: number; target: number | null; projection: number };
  ranking: Array<{ name: string; total: number; count: number }>;
  byHour: Array<{ hour: number; total: number }>;
  goals: Array<{ name: string; pct: number; status: GoalStatus; actual: number; target: number; unit: string }>;
  offers: Array<{ name: string; price: number; memberPrice: number; savingPct: number }>;
  /** Segundos até a TV buscar de novo. */
  refreshSeconds: number;
}
