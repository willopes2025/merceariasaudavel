import { z } from 'zod';
import { parseNumber, quantity, type LossReason, type Unit } from './products';

/**
 * Shakes, sorvetes e insumos.
 * Cada preparado tem ficha técnica; vender um shake baixa o whey, o leite, o
 * copo e a tampa. No fim do dia a equipe conta os insumos abertos: a diferença
 * entre o que o sistema esperava (pelas vendas) e o que sobrou é a perda.
 */

export const recipeSchema = z.object({
  items: z
    .array(
      z.object({
        ingredientId: z.string().uuid('Escolha o insumo'),
        /** Na unidade do insumo (30 g de whey controlado em KG = 0,030). */
        quantity: z
          .preprocess((v) => parseNumber(v), z.number({ invalid_type_error: 'Quantidade inválida', required_error: 'Informe a quantidade' }).positive('Quantidade maior que zero').max(100_000))
          .transform((v) => Math.round(v * 10000) / 10000),
      }),
    )
    .max(40)
    .refine((items) => new Set(items.map((i) => i.ingredientId)).size === items.length, 'O mesmo insumo apareceu duas vezes'),
});
export type RecipeInput = z.infer<typeof recipeSchema>;

/** Folha de contagem: insumos (ou todo o estoque) com o que o sistema tem agora. */
export interface CountSheetLine {
  productId: string;
  name: string;
  unit: Unit;
  categoryName: string | null;
  system: number;
  unitCost: number;
}

export const COUNT_SCOPES = { insumos: 'Insumos do preparo (fim do dia)', geral: 'Inventário geral' } as const;
export type CountScope = keyof typeof COUNT_SCOPES;

export const inventoryCountSchema = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  scope: z.enum(['insumos', 'geral']).default('insumos'),
  lines: z
    .array(z.object({ productId: z.string().uuid(), counted: quantity(0) }))
    .min(1, 'Conte pelo menos um item')
    .max(2000),
  note: z.string().trim().max(300).nullish(),
});
export type InventoryCountInput = z.infer<typeof inventoryCountSchema>;

export interface InventoryCountLine {
  productId: string;
  name: string;
  unit: Unit;
  system: number;
  counted: number;
  diff: number;
  /** Diferença a custo (negativo = faltou). */
  value: number;
}

export interface InventoryCount {
  id: string;
  storeName: string;
  scope: CountScope;
  day: string;
  userName: string | null;
  diffValue: number;
  lines: InventoryCountLine[];
  createdAt: string;
}

export interface InventoryCountRow {
  id: string;
  storeName: string;
  scope: CountScope;
  day: string;
  userName: string | null;
  items: number;
  diffValue: number;
  createdAt: string;
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
export const lossReportQuery = z.object({
  from: isoDay,
  to: isoDay,
  storeId: z.string().uuid().optional(),
});
export type LossReportQuery = z.infer<typeof lossReportQuery>;

/**
 * Perdas do período. "Consumo previsto" é o que as vendas de preparados
 * deveriam ter gastado de cada insumo; perda = lançada + diferença das contagens.
 */
export interface LossReport {
  from: string;
  to: string;
  /** Valor a custo de tudo que se perdeu. */
  totalValue: number;
  /** Perda ÷ (consumo previsto + perda) em valor, só dos insumos. */
  insumoLossPct: number;
  byReason: Array<{ reason: LossReason | 'contagem'; label: string; value: number }>;
  byProduct: Array<{
    productId: string;
    name: string;
    unit: Unit;
    /** Gasto previsto pelas vendas (ficha técnica). */
    expectedUse: number;
    /** Perda lançada (vencido, avaria…). */
    lossQty: number;
    /** Faltou na contagem (positivo = faltou). */
    countMissing: number;
    value: number;
    /** % de perda sobre o uso previsto. */
    pct: number | null;
  }>;
  /** Margem de cada preparado pela ficha técnica. */
  recipes: Array<{ productId: string; name: string; price: number; memberPrice: number | null; cost: number; margin: number; memberMargin: number | null; sold: number }>;
}
