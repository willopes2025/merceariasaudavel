import { z } from 'zod';

/**
 * Produtos e estoque.
 * O saldo só muda por movimentação (entrada, perda, acerto, contagem, venda…),
 * e movimentação não se altera nem se apaga. Produto com lote sai pelo FEFO:
 * primeiro o lote que vence primeiro.
 */

export const PRODUCT_KINDS = {
  revenda: 'Produto de revenda',
  insumo: 'Insumo',
  preparado: 'Preparado na loja (shake, sorvete…)',
} as const;
export type ProductKind = keyof typeof PRODUCT_KINDS;

export const UNITS = {
  UN: 'Unidade',
  KG: 'Quilo',
  G: 'Grama',
  L: 'Litro',
  ML: 'Mililitro',
  CX: 'Caixa',
  PCT: 'Pacote',
} as const;
export type Unit = keyof typeof UNITS;

/** Número com vírgula ou ponto ("1.234,50", "0,350", 12.5). */
export const parseNumber = (v: unknown): unknown => {
  if (v === '' || v == null) return undefined;
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

const money = z
  .preprocess((v) => parseNumber(v) ?? 0, z.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo').max(1_000_000))
  .transform((v) => Math.round(v * 100) / 100);
const cost = z
  .preprocess((v) => parseNumber(v) ?? 0, z.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo').max(1_000_000))
  .transform((v) => Math.round(v * 10000) / 10000);
/** Quantidade com até 3 casas (0,350 kg). */
export const quantity = (min = 0.001) =>
  z
    .preprocess((v) => parseNumber(v), z.number({ invalid_type_error: 'Quantidade inválida', required_error: 'Informe a quantidade' }).min(min, min > 0 ? 'Quantidade maior que zero' : 'Não pode ser negativo').max(1_000_000))
    .transform((v) => Math.round(v * 1000) / 1000);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const productSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome').max(150),
    kind: z.enum(Object.keys(PRODUCT_KINDS) as [ProductKind, ...ProductKind[]]),
    categoryId: z
      .string()
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    brand: optional(60),
    /** Código interno; único quando preenchido. */
    sku: optional(60),
    /** Código de barras (EAN); único quando preenchido. */
    barcode: z
      .string()
      .trim()
      .nullish()
      .transform((v) => (v ? v.replace(/\s/g, '') : null))
      .refine((v) => v === null || /^[0-9A-Za-z-]{4,30}$/.test(v), 'Código de barras inválido'),
    unit: z.enum(Object.keys(UNITS) as [Unit, ...Unit[]]).default('UN'),
    /** Vendido na balança (quantidade em kg com casas decimais). */
    soldByWeight: z.boolean().default(false),
    price: money,
    /** Preço de membro. Vazio = o mesmo preço para todos. */
    memberPrice: z
      .preprocess((v) => parseNumber(v) ?? null, z.number({ invalid_type_error: 'Valor inválido' }).min(0).max(1_000_000).nullable())
      .transform((v) => (v == null ? null : Math.round(v * 100) / 100)),
    cost,
    trackStock: z.boolean().default(true),
    trackLots: z.boolean().default(false),
    minStock: z.preprocess((v) => parseNumber(v) ?? 0, z.number().min(0).max(1_000_000)),
    /** Insumo que também é vendido avulso no caixa. */
    sellable: z.boolean().default(true),
    ncm: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v === '' || v.length === 8, 'NCM tem 8 números')
      .nullish()
      .transform((v) => (v === undefined ? undefined : v || null)),
    cest: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ''))
      .nullish()
      .transform((v) => (v === undefined ? undefined : v || null)),
    supplier: optional(150),
    /** Vitrine do app e do cardápio. */
    description: optional(400),
    imageUrl: z
      .string()
      .trim()
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || /^https:\/\/\S+$/.test(v), 'A foto precisa ser um link https'),
    showInApp: z.boolean().default(true),
    /** Dura em média (dias): base do aviso de recompra. */
    repurchaseDays: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1, 'Mínimo 1 dia').max(365, 'No máximo 365 dias').nullable()).default(null),
    active: z.boolean().default(true),
  })
  .refine((p) => p.memberPrice == null || p.memberPrice <= p.price, { path: ['memberPrice'], message: 'O preço de membro tem que ser menor ou igual ao preço normal' })
  .refine((p) => !p.soldByWeight || p.unit === 'KG', { path: ['unit'], message: 'Produto vendido na balança usa a unidade KG' })
  .transform((p) => (p.kind === 'preparado' ? { ...p, trackStock: false, trackLots: false } : p))
  .transform((p) => (p.trackStock ? p : { ...p, trackLots: false }));
export type ProductInput = z.infer<typeof productSchema>;
export type ProductForm = z.input<typeof productSchema>;

export interface StockByStore {
  storeId: string;
  storeName: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  kind: ProductKind;
  categoryId: string | null;
  categoryName: string | null;
  brand: string | null;
  sku: string | null;
  barcode: string | null;
  unit: Unit;
  soldByWeight: boolean;
  price: number;
  memberPrice: number | null;
  cost: number;
  trackStock: boolean;
  trackLots: boolean;
  minStock: number;
  sellable: boolean;
  ncm: string | null;
  cest: string | null;
  supplier: string | null;
  description: string | null;
  imageUrl: string | null;
  showInApp: boolean;
  repurchaseDays: number | null;
  active: boolean;
  stock: StockByStore[];
  totalStock: number;
  /** Abaixo do mínimo em alguma loja. */
  low: boolean;
  /** Preparado: custo da ficha técnica (soma dos insumos). */
  recipeCost: number | null;
}

export interface StockLot {
  id: string;
  storeId: string;
  storeName: string;
  code: string;
  expiresAt: string | null;
  quantity: number;
  /** Dias até vencer (negativo = vencido). */
  daysLeft: number | null;
}

export const STOCK_MOVEMENT_TYPES = {
  entrada: 'Entrada',
  saida: 'Saída',
  perda: 'Perda',
  ajuste: 'Acerto de estoque',
  contagem: 'Contagem',
  transferencia: 'Transferência',
  venda: 'Venda',
  venda_cancelada: 'Venda cancelada',
  consumo: 'Usado no preparo',
  consumo_estorno: 'Preparo cancelado',
} as const;
export type StockMovementType = keyof typeof STOCK_MOVEMENT_TYPES;

export const LOSS_REASONS = {
  vencido: 'Venceu',
  avaria: 'Avaria / quebra',
  preparo: 'Erro no preparo',
  degustacao: 'Degustação',
  consumo_interno: 'Consumo da equipe',
  furto: 'Furto / sumiço',
  outro: 'Outro',
} as const;
export type LossReason = keyof typeof LOSS_REASONS;

export interface StockMovement {
  id: string;
  type: StockMovementType;
  storeName: string;
  /** Positivo entra, negativo sai. */
  delta: number;
  balanceAfter: number;
  lotCode: string | null;
  reason: LossReason | null;
  note: string | null;
  saleId: string | null;
  saleNumber: number | null;
  userName: string | null;
  at: string;
}

export interface RecipeLine {
  ingredientId: string;
  ingredientName: string;
  unit: Unit;
  quantity: number;
  unitCost: number;
  cost: number;
}

export interface ProductDetail extends Product {
  lots: StockLot[];
  movements: StockMovement[];
  /** Preparado: a ficha técnica. */
  recipe: RecipeLine[];
  /** Insumo: em quais preparados ele entra. */
  usedIn: Array<{ productId: string; name: string; quantity: number }>;
  /** Montagem (sabor, adicionais). */
  optionGroups: OptionGroupView[];
}

const lotFields = {
  /** Lote (obrigatório quando o produto controla lote). */
  lotCode: optional(40),
  /** Validade do lote (AAAA-MM-DD). */
  expiresAt: z
    .string()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Data inválida'),
};

export const stockMoveSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('entrada'),
    storeId: z.string().uuid('Escolha a loja'),
    quantity: quantity(),
    /** Custo unitário desta compra; atualiza o custo do produto. */
    unitCost: z.preprocess((v) => parseNumber(v), z.number().min(0).max(1_000_000).optional()),
    note: optional(200),
    ...lotFields,
  }),
  z.object({
    type: z.literal('perda'),
    storeId: z.string().uuid('Escolha a loja'),
    quantity: quantity(),
    reason: z.enum(Object.keys(LOSS_REASONS) as [LossReason, ...LossReason[]], { errorMap: () => ({ message: 'Escolha o motivo da perda' }) }),
    /** Lote que se perdeu (vazio = o que vence primeiro). */
    lotId: z.string().uuid().nullish(),
    note: optional(200),
  }),
  z.object({ type: z.literal('saida'), storeId: z.string().uuid('Escolha a loja'), quantity: quantity(), note: z.string().trim().min(3, 'Diga o motivo da saída').max(200) }),
  /** Acerto: informa quanto TEM de verdade na prateleira. */
  z.object({ type: z.literal('ajuste'), storeId: z.string().uuid('Escolha a loja'), quantity: quantity(0), note: optional(200) }),
  z.object({ type: z.literal('transferencia'), storeId: z.string().uuid('Escolha a loja de origem'), toStoreId: z.string().uuid('Escolha a loja de destino'), quantity: quantity(), note: optional(200) }),
]);
export type StockMoveInput = z.infer<typeof stockMoveSchema>;

export const productListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  kind: z.enum(Object.keys(PRODUCT_KINDS) as [ProductKind, ...ProductKind[]]).optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  /** low = abaixo do mínimo; out = zerado ou negativo. */
  stock: z.enum(['all', 'low', 'out']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ProductListQuery = z.infer<typeof productListQuery>;

/** Para o caixa: o mínimo para vender rápido. */
export interface ProductOption {
  id: string;
  name: string;
  kind: ProductKind;
  barcode: string | null;
  sku: string | null;
  unit: Unit;
  soldByWeight: boolean;
  price: number;
  memberPrice: number | null;
  trackStock: boolean;
  /** Saldo na loja do caixa (null = não controla). */
  stock: number | null;
  categoryName: string | null;
  /** Tem montagem (sabor, adicionais): o caixa abre a escolha antes de pôr no carrinho. */
  optionGroups: OptionGroupView[];
}

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(60),
  active: z.boolean().default(true),
});
export type CategoryInput = z.infer<typeof categorySchema>;
export interface Category {
  id: string;
  name: string;
  active: boolean;
  products: number;
}

/** Lotes vencendo (ou vencidos) — vira alerta no painel e sugestão de promoção. */
export interface ExpiringLot extends Omit<StockLot, "daysLeft"> {
  daysLeft: number;
  productId: string;
  productName: string;
  unit: Unit;
  /** Valor a custo do que está no lote. */
  value: number;
}

/** Preço que vale para a venda: membro paga o preço de membro quando existe. */
export function priceFor(p: { price: number; memberPrice: number | null }, member: boolean): number {
  return member && p.memberPrice != null && p.memberPrice < p.price ? p.memberPrice : p.price;
}

// ------------------------------------------------------------ montagem

/**
 * Montagem do produto (shake, sorvete…): grupos como "Sabor" (escolhe 1) e
 * "Adicionais" (até 3). Cada opção pode custar a mais e gastar um insumo.
 */
export interface OptionChoice {
  id: string;
  name: string;
  /** Somado ao preço do item. */
  price: number;
  supplyId: string | null;
  supplyName: string | null;
  supplyUnit: Unit | null;
  supplyQty: number | null;
}

export interface OptionGroupView {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: OptionChoice[];
}

const optionMoney = z
  .preprocess((v) => parseNumber(v) ?? 0, z.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Não pode ser negativo').max(10_000))
  .transform((v) => Math.round(v * 100) / 100);

export const optionGroupsSchema = z.object({
  groups: z
    .array(
      z
        .object({
          id: z.string().uuid().nullish(),
          name: z.string().trim().min(1, 'Dê um nome ao grupo (ex.: Sabor)').max(60),
          minSelect: z.coerce.number().int().min(0).max(20),
          maxSelect: z.coerce.number().int().min(1, 'Pelo menos 1 escolha').max(20),
          options: z
            .array(
              z
                .object({
                  id: z.string().uuid().nullish(),
                  name: z.string().trim().min(1, 'Dê um nome à opção').max(60),
                  price: optionMoney,
                  supplyId: z.string().uuid().nullish().transform((v) => v ?? null),
                  supplyQty: z
                    .preprocess((v) => (v === '' || v == null ? null : parseNumber(v)), z.number().positive('Quantidade do insumo maior que zero').max(100_000).nullable())
                    .transform((v) => (v == null ? null : Math.round(v * 1000) / 1000)),
                })
                .refine((o) => (o.supplyId == null) === (o.supplyQty == null), { message: 'Informe o insumo e a quantidade juntos', path: ['supplyQty'] }),
            )
            .min(1, 'Coloque pelo menos uma opção no grupo')
            .max(40),
        })
        .refine((g) => g.maxSelect >= g.minSelect, { message: 'O máximo não pode ser menor que o mínimo', path: ['maxSelect'] })
        .refine((g) => g.minSelect <= g.options.length, { message: 'O mínimo é maior que o número de opções', path: ['minSelect'] }),
    )
    .max(10),
});
export type OptionGroupsInput = z.infer<typeof optionGroupsSchema>;

/** Texto curto das escolhas: "Morango, + Pasta de amendoim". */
export function optionsLabel(options: Array<{ name: string }>): string {
  return options.map((o) => o.name).join(', ');
}
