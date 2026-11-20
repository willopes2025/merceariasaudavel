import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Quantidade sempre com 3 casas (0,350 kg). */
export const q3 = (v: number | Prisma.Decimal | null | undefined): number => Math.round(Number(v ?? 0) * 1000) / 1000;

export interface StockChange {
  tenantId: string;
  productId: string;
  storeId: string;
  type: string;
  delta: number;
  userId: string;
  unitCost?: number;
  lotId?: string | null;
  saleId?: string | null;
  countId?: string | null;
  reason?: string | null;
  note?: string | null;
}

/**
 * Único jeito de mexer no saldo: soma o delta de forma atômica (duas vendas ao
 * mesmo tempo não se atropelam) e grava a movimentação com o saldo resultante.
 * Quem chama já resolveu o lote (o saldo do lote anda à parte, em takeStock/putStock).
 */
export async function applyStock(tx: Tx, change: StockChange): Promise<number> {
  const c = { ...change, storeId: await stockStoreOf(tx, change.storeId), delta: q3(change.delta) };
  if (c.delta === 0) return currentStock(tx, c.productId, c.storeId);
  const rows = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal }>>`
    INSERT INTO stock_balance (tenant_id, product_id, store_id, quantity) VALUES (${c.tenantId}, ${c.productId}, ${c.storeId}, ${c.delta})
    ON CONFLICT (product_id, store_id) DO UPDATE SET quantity = stock_balance.quantity + ${c.delta}
    RETURNING quantity`;
  const balanceAfter = q3(rows[0]!.quantity);
  await tx.stockMovement.create({
    data: {
      tenantId: c.tenantId,
      productId: c.productId,
      storeId: c.storeId,
      type: c.type,
      delta: c.delta,
      balanceAfter,
      unitCost: c.unitCost ?? 0,
      lotId: c.lotId ?? null,
      saleId: c.saleId ?? null,
      countId: c.countId ?? null,
      reason: c.reason ?? null,
      note: c.note ?? null,
      userId: c.userId,
    },
  });
  return balanceAfter;
}

/** Loja que guarda o estoque: a própria, ou aquela com quem ela divide o estoque. */
export async function stockStoreOf(tx: Tx, storeId: string): Promise<string> {
  const store = await tx.store.findUnique({ where: { id: storeId }, select: { stockStoreId: true } });
  return store?.stockStoreId ?? storeId;
}

export async function currentStock(tx: Tx, productId: string, anyStoreId: string): Promise<number> {
  const storeId = await stockStoreOf(tx, anyStoreId);
  const row = await tx.stockBalance.findUnique({ where: { productId_storeId: { productId, storeId } } });
  return q3(row?.quantity);
}

type Base = Omit<StockChange, 'delta' | 'lotId'>;

/**
 * Entrada. Produto com lote: soma no lote (cria se não existe) e a
 * movimentação fica ligada a ele.
 */
export async function putStock(tx: Tx, base: Base, quantity: number, lot?: { code: string; expiresAt: string | null } | null): Promise<void> {
  if (!lot) {
    await applyStock(tx, { ...base, delta: quantity });
    return;
  }
  const storeId = await stockStoreOf(tx, base.storeId);
  const expires = lot.expiresAt ? new Date(`${lot.expiresAt}T00:00:00Z`) : null;
  const row = await tx.stockLot.upsert({
    where: { productId_storeId_code: { productId: base.productId, storeId, code: lot.code } },
    create: { tenantId: base.tenantId, productId: base.productId, storeId, code: lot.code, expiresAt: expires, quantity: q3(quantity) },
    update: { quantity: { increment: q3(quantity) }, ...(expires ? { expiresAt: expires } : {}) },
  });
  await applyStock(tx, { ...base, storeId, delta: quantity, lotId: row.id });
}

/**
 * Saída (venda, perda, consumo do preparo). Produto com lote sai pelo FEFO: o
 * lote que vence primeiro. O que passar do que há nos lotes sai "sem lote" e o
 * saldo pode ficar negativo (venda sem estoque avisa, mas não bloqueia).
 * `lotId` força um lote (perda de um lote específico).
 */
export async function takeStock(tx: Tx, base: Base, quantity: number, opts: { trackLots: boolean; lotId?: string | null }): Promise<void> {
  let left = q3(quantity);
  if (left <= 0) return;
  if (opts.trackLots) {
    const storeId = await stockStoreOf(tx, base.storeId);
    const lots = opts.lotId
      ? await tx.$queryRaw<Array<{ id: string; quantity: Prisma.Decimal }>>`
          SELECT id, quantity FROM stock_lot WHERE id = ${opts.lotId} AND product_id = ${base.productId} AND store_id = ${storeId} AND quantity > 0 FOR UPDATE`
      : await tx.$queryRaw<Array<{ id: string; quantity: Prisma.Decimal }>>`
          SELECT id, quantity FROM stock_lot WHERE product_id = ${base.productId} AND store_id = ${storeId} AND quantity > 0
           ORDER BY expires_at ASC NULLS LAST, created_at ASC FOR UPDATE`;
    for (const lot of lots) {
      if (left <= 0) break;
      const take = Math.min(left, q3(lot.quantity));
      await tx.stockLot.update({ where: { id: lot.id }, data: { quantity: { decrement: take } } });
      await applyStock(tx, { ...base, storeId, delta: -take, lotId: lot.id });
      left = q3(left - take);
    }
  }
  if (left > 0) await applyStock(tx, { ...base, delta: -left });
}

/** Desfaz as saídas de uma venda (cancelamento): devolve cada lote do jeito que saiu. */
export async function returnSaleStock(tx: Tx, p: { tenantId: string; saleId: string; userId: string; note: string }): Promise<void> {
  const moves = await tx.stockMovement.findMany({ where: { tenantId: p.tenantId, saleId: p.saleId, type: { in: ['venda', 'consumo'] } }, orderBy: { createdAt: 'asc' } });
  for (const m of moves) {
    const qty = -q3(m.delta);
    if (qty <= 0) continue;
    if (m.lotId) await tx.stockLot.update({ where: { id: m.lotId }, data: { quantity: { increment: qty } } });
    await applyStock(tx, {
      tenantId: p.tenantId,
      productId: m.productId,
      storeId: m.storeId,
      type: m.type === 'venda' ? 'venda_cancelada' : 'consumo_estorno',
      delta: qty,
      unitCost: Number(m.unitCost),
      lotId: m.lotId,
      saleId: p.saleId,
      userId: p.userId,
      note: p.note,
    });
  }
}

/** Soma as quantidades por produto. */
export function quantities(items: Array<{ productId: string; quantity: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.productId, q3((map.get(i.productId) ?? 0) + i.quantity));
  return map;
}
