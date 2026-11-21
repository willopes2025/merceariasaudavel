import { z } from 'zod';
import { parseNumber } from './products';

/**
 * Campanhas: cupom (código com % ou R$, compra mínima e limites; pode ser só
 * para aniversariante), cashback turbinado (+% do valor pago num período ou
 * dia da semana) e oferta (preço promocional por produto). O caixa, o app e o
 * totem aplicam a mesma regra (a conta é do servidor).
 */

export const CAMPAIGN_TYPES = {
  cupom: 'Cupom de desconto',
  cashback: 'Cashback turbinado',
  oferta: 'Oferta (preço promocional)',
} as const;
export type CampaignType = keyof typeof CAMPAIGN_TYPES;

export const CAMPAIGN_AUDIENCES = {
  todos: 'Todo mundo',
  membros: 'Só membros',
  aniversariantes: 'Aniversariantes do mês',
} as const;
export type CampaignAudience = keyof typeof CAMPAIGN_AUDIENCES;

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const money = (msg = 'Valor inválido') =>
  z.preprocess((v) => (v === '' || v == null ? null : parseNumber(v)), z.number({ invalid_type_error: msg }).min(0).max(1_000_000).nullable()).transform((v) => (v == null ? null : Math.round(v * 100) / 100));
const pct = z.preprocess((v) => (v === '' || v == null ? null : parseNumber(v)), z.number({ invalid_type_error: '% inválido' }).gt(0, 'Maior que zero').max(100, 'No máximo 100%').nullable());
const count = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).max(1_000_000).nullable());

export const campaignSchema = z
  .object({
    name: z.string().trim().min(3, 'Dê um nome à campanha').max(80),
    type: z.enum(['cupom', 'cashback', 'oferta']),
    active: z.boolean().default(true),
    startsOn: day,
    endsOn: day,
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    audience: z.enum(['todos', 'membros', 'aniversariantes']).default('todos'),
    description: z
      .string()
      .trim()
      .max(160)
      .nullish()
      .transform((v) => v || null),
    // cupom
    code: z
      .string()
      .trim()
      .toUpperCase()
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || /^[A-Z0-9-]{3,20}$/.test(v), 'Código: 3 a 20 letras, números ou hífen'),
    discountPct: pct.default(null),
    discountAmount: money().default(null),
    minPurchase: money().default(0).transform((v) => v ?? 0),
    maxUses: count.default(null),
    maxPerCustomer: count.default(null),
    // cashback
    extraCashbackPct: pct.default(null),
    scope: z.enum(['tudo', 'categorias', 'produtos']).default('tudo'),
    categoryIds: z.array(z.string().uuid()).max(100).default([]),
    /** Cashback: produtos da campanha. Oferta: produto + preço promocional. */
    products: z
      .array(z.object({ productId: z.string().uuid(), promoPrice: money('Preço inválido').default(null) }))
      .max(300)
      .default([]),
  })
  .superRefine((c, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: 'custom', message, path: [path] });
    if (c.endsOn < c.startsOn) issue('O fim não pode ser antes do começo', 'endsOn');
    if (c.type !== 'cupom' && c.audience === 'aniversariantes') issue('Aniversariante vale só para cupom', 'audience');
    if (c.type === 'cupom') {
      if (!c.code) issue('Informe o código do cupom', 'code');
      if ((c.discountPct == null) === (c.discountAmount == null)) issue('Informe o desconto em % ou em R$ (um dos dois)', 'discountPct');
      if (c.discountAmount != null && c.discountAmount <= 0) issue('Desconto maior que zero', 'discountAmount');
    }
    if (c.type === 'cashback') {
      if (c.extraCashbackPct == null) issue('Informe quanto % de cashback a mais', 'extraCashbackPct');
      if (c.scope === 'categorias' && !c.categoryIds.length) issue('Escolha as categorias', 'categoryIds');
      if (c.scope === 'produtos' && !c.products.length) issue('Escolha os produtos', 'products');
    }
    if (c.type === 'oferta') {
      if (!c.products.length) issue('Coloque pelo menos um produto na oferta', 'products');
      if (c.products.some((p) => p.promoPrice == null)) issue('Informe o preço promocional de cada produto', 'products');
    }
  });
export type CampaignInput = z.infer<typeof campaignSchema>;

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  active: boolean;
  startsOn: string;
  endsOn: string;
  weekdays: number[];
  audience: CampaignAudience;
  description: string | null;
  code: string | null;
  discountPct: number | null;
  discountAmount: number | null;
  minPurchase: number;
  maxUses: number | null;
  maxPerCustomer: number | null;
  extraCashbackPct: number | null;
  scope: 'tudo' | 'categorias' | 'produtos';
  categories: Array<{ id: string; name: string }>;
  products: Array<{ productId: string; name: string; price: number; memberPrice: number | null; promoPrice: number | null }>;
  /** Rodando agora (ativa, no período e no dia da semana). */
  runningNow: boolean;
  stats: {
    /** Vendas que usaram o cupom / a oferta / ganharam cashback extra. */
    sales: number;
    revenue: number;
    /** Desconto dado (cupom) ou economia das ofertas. */
    discount: number;
    /** Cashback extra pago. */
    cashback: number;
  };
}

/** Rodando no dia (AAAA-MM-DD) e dia da semana dados. */
export function campaignRunsOn(c: { active: boolean; startsOn: string; endsOn: string; weekdays: number[] }, isoDay: string, weekday: number): boolean {
  return c.active && c.startsOn <= isoDay && c.endsOn >= isoDay && (!c.weekdays.length || c.weekdays.includes(weekday));
}

/** Resumo de uma linha: "10% em compras a partir de R$ 50, até 1 por cliente". */
export function couponSummary(c: Pick<Campaign, 'discountPct' | 'discountAmount' | 'minPurchase' | 'maxPerCustomer'>): string {
  const off = c.discountPct != null ? `${c.discountPct.toLocaleString('pt-BR')}% de desconto` : `R$ ${(c.discountAmount ?? 0).toFixed(2).replace('.', ',')} de desconto`;
  const min = c.minPurchase > 0 ? ` em compras a partir de R$ ${c.minPurchase.toFixed(2).replace('.', ',')}` : '';
  const per = c.maxPerCustomer ? `, ${c.maxPerCustomer === 1 ? 'uma vez' : `até ${c.maxPerCustomer} vezes`} por cliente` : '';
  return `${off}${min}${per}`;
}
