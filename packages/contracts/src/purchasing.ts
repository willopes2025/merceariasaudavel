import { z } from 'zod';
import { normalizePhone, onlyDigits } from './br';
import { parseNumber, type ProductKind, type Unit } from './products';

/**
 * Inteligência de estoque e compras: fornecedores, análise por produto
 * (curva ABC, venda por dia, cobertura, giro, ruptura, dinheiro parado,
 * risco de vencer) e pedido de compra sugerido por fornecedor.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do fornecedor').max(160),
  document: z
    .string()
    .nullish()
    .transform((v) => onlyDigits(v) || null)
    .refine((v) => v === null || v.length === 11 || v.length === 14, 'CNPJ ou CPF inválido'),
  phone: z
    .string()
    .nullish()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const n = normalizePhone(v);
      if (!n) {
        ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido: use DDD + número' });
        return z.NEVER;
      }
      return n;
    }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, 'E-mail inválido'),
  contactName: optional(80),
  leadTimeDays: z.coerce.number().int().min(0, 'Prazo inválido').max(120, 'No máximo 120 dias').default(7),
  minOrder: z.preprocess((v) => (v === '' || v == null ? 0 : parseNumber(v)), z.number().min(0).max(1_000_000)).default(0),
  notes: optional(500),
  active: z.boolean().default(true),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

export interface Supplier {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  leadTimeDays: number;
  minOrder: number;
  notes: string | null;
  active: boolean;
  products: number;
}

/** Situação do produto na análise. */
export const STOCK_STATUS = {
  ruptura: 'Em falta',
  comprar: 'Comprar agora',
  atencao: 'Comprar em breve',
  ok: 'Ok',
  excesso: 'Estoque demais',
  parado: 'Parado',
  sem_giro: 'Sem venda',
} as const;
export type StockStatus = keyof typeof STOCK_STATUS;

export interface StockIntelRow {
  productId: string;
  name: string;
  kind: ProductKind;
  unit: Unit;
  categoryName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  stock: number;
  /** Saída média por dia no período (venda + consumo do preparo). */
  dailyUse: number;
  /** Dias que o estoque aguenta no ritmo atual (null = sem saída). */
  coverDays: number | null;
  /** Faturamento no período (revenda) ou custo consumido (insumo). */
  revenue: number;
  /** Margem bruta no período (revenda). */
  margin: number | null;
  abc: 'A' | 'B' | 'C';
  /** Giro anualizado: saída a custo ÷ estoque a custo. */
  turnover: number | null;
  stockValue: number;
  daysSinceLastOut: number | null;
  leadTimeDays: number;
  /** Quantidade já pedida (pedidos enviados ainda não recebidos). */
  onOrder: number;
  /** Quanto comprar (já arredondado ao múltiplo de compra). */
  suggested: number;
  suggestedCost: number;
  status: StockStatus;
  /** Lotes que devem vencer antes de vender no ritmo atual. */
  expiryRisk: { quantity: number; value: number; firstDate: string } | null;
}

export interface StockIntel {
  days: number;
  storeId: string;
  coverTarget: number;
  totals: {
    stockValue: number;
    /** Sem saída no período, com estoque. */
    idleValue: number;
    missing: number;
    toBuy: number;
    suggestedCost: number;
    expiryRiskValue: number;
  };
  rows: StockIntelRow[];
}

export const stockIntelQuery = z.object({
  storeId: z.string().uuid(),
  days: z.coerce.number().int().min(14).max(365).default(60),
  /** Comprar para aguentar quantos dias além do prazo do fornecedor. */
  coverTarget: z.coerce.number().int().min(3).max(120).default(21),
});
export type StockIntelQuery = z.infer<typeof stockIntelQuery>;

// ------------------------------------------------------------ pedido de compra

export const PURCHASE_STATUS = { rascunho: 'Rascunho', enviado: 'Enviado', recebido: 'Recebido', cancelado: 'Cancelado' } as const;
export type PurchaseStatus = keyof typeof PURCHASE_STATUS;

export const purchaseOrderSchema = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  supplierId: z.string().uuid('Escolha o fornecedor'),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.preprocess((v) => parseNumber(v), z.number({ invalid_type_error: 'Quantidade inválida' }).positive('Quantidade maior que zero').max(1_000_000)),
        unitCost: z.preprocess((v) => (v === '' || v == null ? 0 : parseNumber(v)), z.number().min(0).max(1_000_000)).default(0),
      }),
    )
    .min(1, 'Coloque pelo menos um produto')
    .max(300),
  notes: optional(500),
  expectedOn: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Data inválida'),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

export const purchaseStatusSchema = z.object({ status: z.enum(['enviado', 'recebido', 'cancelado']) });
export type PurchaseStatusInput = z.infer<typeof purchaseStatusSchema>;

export interface PurchaseOrder {
  id: string;
  number: number;
  storeId: string;
  supplierId: string;
  supplierName: string;
  supplierPhone: string | null;
  status: PurchaseStatus;
  items: Array<{ productId: string; name: string; unit: Unit; quantity: number; unitCost: number; total: number }>;
  total: number;
  notes: string | null;
  expectedOn: string | null;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  createdByName: string | null;
}

/** Texto do pedido para mandar ao fornecedor pelo WhatsApp. */
export function purchaseOrderText(o: Pick<PurchaseOrder, 'number' | 'items' | 'notes' | 'expectedOn'>, storeName: string): string {
  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const lines = o.items.map((i) => `• ${fmt(i.quantity)} ${i.unit.toLowerCase()} — ${i.name}`);
  return [
    `Olá! Pedido de compra nº ${o.number} da ${storeName}:`,
    '',
    ...lines,
    '',
    o.expectedOn ? `Precisamos para ${o.expectedOn.split('-').reverse().join('/')}.` : null,
    o.notes ? `Obs.: ${o.notes}` : null,
    'Pode confirmar disponibilidade e prazo, por favor? Obrigado!',
  ]
    .filter((l) => l !== null)
    .join('\n');
}
