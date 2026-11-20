import { z } from 'zod';
import { PRODUCT_KINDS, type ProductKind } from './products';

/**
 * Entrada de mercadoria pelo XML da nota do fornecedor (NF-e de compra).
 * O servidor lê o XML; a tela só decide o que fazer com cada item.
 */

/** Tipo provável do produto da nota de compra: embalagem e copo viram insumo. */
export function kindFromNcm(ncm: string | null | undefined): ProductKind {
  const n = (ncm ?? '').replace(/\D/g, '');
  // Copos, tampas, canudos e embalagens de papel/plástico.
  if (/^(3923|3924|4823|4819)/.test(n)) return 'insumo';
  return 'revenda';
}

export const stockEntryPreviewSchema = z.object({
  xml: z.string().min(50, 'Arquivo vazio').max(5_000_000, 'Arquivo grande demais para uma nota'),
});

export interface StockEntryItem {
  index: number;
  /** Código do produto no fornecedor. */
  code: string;
  ean: string | null;
  description: string;
  ncm: string | null;
  unit: string | null;
  quantity: number;
  unitCost: number;
  total: number;
  /** Produto do Mercearia que já corresponde a este item. */
  match: { productId: string; name: string; sku: string | null; via: 'memoria' | 'codigo' } | null;
  suggestedKind: ProductKind;
  /** Lote e validade que o fornecedor informou na nota. */
  lots: Array<{ code: string; expiresAt: string | null; quantity: number }>;
  /** O que impede dar entrada deste item (ex.: quantidade quebrada). */
  problem: string | null;
}

export interface StockEntryPreview {
  accessKey: string;
  number: string;
  series: string | null;
  issuedAt: string;
  supplier: { name: string; document: string };
  total: number;
  /** Esta nota já deu entrada antes. */
  alreadyImported: boolean;
  items: StockEntryItem[];
  installments: Array<{ number: string; dueDate: string; amount: number }>;
}

const money = z.preprocess(
  (v) => (v === '' || v == null ? 0 : typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v) : v),
  z.number({ invalid_type_error: 'Valor inválido' }).min(0).max(1_000_000),
).transform((v) => Math.round(v * 100) / 100);

const line = z.discriminatedUnion('action', [
  z.object({ index: z.number().int().min(0), action: z.literal('skip') }),
  z.object({ index: z.number().int().min(0), action: z.literal('link'), productId: z.string().uuid('Escolha o produto') }),
  z.object({
    index: z.number().int().min(0),
    action: z.literal('create'),
    name: z.string().trim().min(2, 'Informe o nome do produto').max(150),
    kind: z.enum(Object.keys(PRODUCT_KINDS) as [ProductKind, ...ProductKind[]]),
    /** Preço de venda. */
    price: money,
  }),
]);
export type StockEntryLine = z.infer<typeof line>;

export const stockEntrySchema = z.object({
  xml: stockEntryPreviewSchema.shape.xml,
  storeId: z.string().uuid('Escolha a loja'),
  lines: z.array(line).min(1).max(990),
  /** Lança as duplicatas da nota em contas a pagar. */
  createPayables: z.boolean().default(true),
});
export type StockEntryInput = z.infer<typeof stockEntrySchema>;

export interface StockEntryResult {
  id: string;
  created: number;
  linked: number;
  skipped: number;
  units: number;
  payables: number;
}

export interface StockEntryRow {
  id: string;
  number: string;
  supplierName: string;
  storeName: string;
  issuedAt: string;
  total: number;
  createdAt: string;
  userName: string | null;
}
