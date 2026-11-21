import { Prisma } from '@prisma/client';
import { todayBR, type ProductKind, type StockIntel, type StockIntelQuery, type StockIntelRow, type StockStatus, type Unit } from '@mercearia/contracts';
import { q3, stockStoreOf } from '../products/stock';

type Db = Prisma.TransactionClient;
const DAY = 86_400_000;
const money = (v: number) => Math.round(v * 100) / 100;
const roundUp = (v: number, step: number) => (v <= 0 ? 0 : Math.ceil(v / step - 1e-9) * step);

/**
 * Análise do estoque de uma loja. Saída = venda + consumo do preparo (menos
 * cancelamentos) no período; cobertura = estoque ÷ saída por dia. A compra
 * sugerida cobre o prazo do fornecedor + `coverTarget` dias + o estoque
 * mínimo, descontando o que já foi pedido, e arredonda para o múltiplo.
 */
export async function stockIntelligence(db: Db, tenantId: string, q: StockIntelQuery): Promise<StockIntel> {
  const stockStore = await stockStoreOf(db, q.storeId);
  const since = new Date(Date.now() - q.days * DAY);
  const [products, outs, sales, onOrderRows, lots] = await Promise.all([
    db.product.findMany({
      where: { tenantId, active: true, trackStock: true, kind: { not: 'preparado' } },
      include: { balances: { where: { storeId: stockStore } }, category: { select: { name: true } }, mainSupplier: { select: { id: true, name: true, leadTimeDays: true, active: true } } },
    }),
    db.$queryRaw<Array<{ product_id: string; out: Prisma.Decimal; last_out: Date | null }>>`
      SELECT product_id, -SUM(delta) AS out, MAX(CASE WHEN type IN ('venda', 'consumo') THEN created_at END) AS last_out
        FROM stock_movement
       WHERE tenant_id = ${tenantId} AND store_id = ${stockStore} AND created_at >= ${since}
         AND type IN ('venda', 'consumo', 'venda_cancelada', 'consumo_estorno')
       GROUP BY product_id`,
    db.$queryRaw<Array<{ product_id: string; revenue: Prisma.Decimal; cost: Prisma.Decimal }>>`
      SELECT si.product_id, SUM(si.total) AS revenue, SUM(si.unit_cost * si.quantity) AS cost
        FROM sale_item si JOIN sale s ON s.id = si.sale_id
       WHERE s.tenant_id = ${tenantId} AND s.store_id = ${q.storeId} AND s.status = 'completed' AND s.created_at >= ${since}
       GROUP BY si.product_id`,
    db.purchaseOrder.findMany({ where: { tenantId, storeId: q.storeId, status: 'enviado' }, select: { items: true } }),
    db.stockLot.findMany({ where: { tenantId, storeId: stockStore, quantity: { gt: 0 }, expiresAt: { not: null } }, orderBy: { expiresAt: 'asc' }, select: { productId: true, quantity: true, expiresAt: true } }),
  ]);
  // Última saída de todos os tempos (para "parado há X dias").
  const lastEver = await db.$queryRaw<Array<{ product_id: string; last_out: Date }>>`
    SELECT product_id, MAX(created_at) AS last_out FROM stock_movement
     WHERE tenant_id = ${tenantId} AND store_id = ${stockStore} AND type IN ('venda', 'consumo') GROUP BY product_id`;
  const outBy = new Map(outs.map((o) => [o.product_id, Math.max(0, Number(o.out))]));
  const lastBy = new Map(lastEver.map((o) => [o.product_id, o.last_out]));
  const salesBy = new Map(sales.map((s) => [s.product_id, { revenue: Number(s.revenue), cost: Number(s.cost) }]));
  const onOrder = new Map<string, number>();
  for (const o of onOrderRows) for (const i of o.items as Array<{ productId: string; quantity: number }>) onOrder.set(i.productId, (onOrder.get(i.productId) ?? 0) + Number(i.quantity));
  const lotsBy = new Map<string, Array<{ quantity: number; expiresAt: Date }>>();
  for (const l of lots) lotsBy.set(l.productId, [...(lotsBy.get(l.productId) ?? []), { quantity: Number(l.quantity), expiresAt: l.expiresAt! }]);
  const today = Date.parse(`${todayBR()}T00:00:00Z`);

  const rows: StockIntelRow[] = products.map((p) => {
    const stock = q3(p.balances[0]?.quantity ?? 0);
    const cost = Number(p.cost);
    const out = outBy.get(p.id) ?? 0;
    const daily = out / q.days;
    const s = salesBy.get(p.id);
    const revenue = p.kind === 'insumo' ? out * cost : (s?.revenue ?? 0);
    const leadTime = p.mainSupplier?.leadTimeDays ?? 7;
    const minStock = Number(p.minStock);
    const ordered = q3(onOrder.get(p.id) ?? 0);
    const pack = Number(p.packSize) || 1;
    // Ponto de pedido: o que sai durante o prazo do fornecedor (+3 dias de folga) + o mínimo.
    const reorderPoint = daily * (leadTime + 3) + minStock;
    const target = daily * (leadTime + q.coverTarget) + minStock;
    const available = stock + ordered;
    const suggested = available <= reorderPoint && target > available ? q3(roundUp(target - available, pack)) : 0;
    const coverDays = daily > 0 ? Math.round((stock / daily) * 10) / 10 : null;
    const last = lastBy.get(p.id);
    const daysSinceLastOut = last ? Math.floor((Date.now() - last.getTime()) / DAY) : null;
    let status: StockStatus;
    if (stock <= 0 && (daily > 0 || minStock > 0)) status = 'ruptura';
    else if (suggested > 0 && (coverDays === null || coverDays <= leadTime)) status = 'comprar';
    else if (suggested > 0) status = 'atencao';
    else if (daily === 0 && stock > 0) status = 'parado';
    else if (daily === 0) status = 'sem_giro';
    else if (coverDays !== null && coverDays > 3 * (leadTime + q.coverTarget)) status = 'excesso';
    else status = 'ok';
    // Risco de vencer: lotes (do que vence antes) que o ritmo atual não dá conta de vender.
    let risk = 0;
    let firstRisk: string | null = null;
    let sold = 0;
    for (const l of lotsBy.get(p.id) ?? []) {
      const days = Math.max(0, Math.round((l.expiresAt.getTime() - today) / DAY));
      if (days > 180) break;
      const capacity = Math.max(0, daily * days - sold);
      const lost = Math.max(0, l.quantity - capacity);
      sold += l.quantity - lost;
      if (lost > 0.0005) {
        risk += lost;
        firstRisk ??= l.expiresAt.toISOString().slice(0, 10);
      }
    }
    return {
      productId: p.id,
      name: p.name,
      kind: p.kind as ProductKind,
      unit: p.unit as Unit,
      categoryName: p.category?.name ?? null,
      supplierId: p.mainSupplier?.id ?? null,
      supplierName: p.mainSupplier?.name ?? null,
      stock,
      dailyUse: Math.round(daily * 1000) / 1000,
      coverDays,
      revenue: money(revenue),
      margin: p.kind === 'insumo' || !s ? null : money(s.revenue - s.cost),
      abc: 'C',
      turnover: stock > 0 && daily > 0 ? Math.round(((daily * 365) / stock) * 10) / 10 : null,
      stockValue: money(Math.max(0, stock) * cost),
      daysSinceLastOut,
      leadTimeDays: leadTime,
      onOrder: ordered,
      suggested,
      suggestedCost: money(suggested * cost),
      status,
      expiryRisk: risk > 0 ? { quantity: q3(risk), value: money(risk * cost), firstDate: firstRisk! } : null,
    };
  });

  // Curva ABC pelo valor movimentado (faturamento da revenda, custo consumido do insumo).
  const total = rows.reduce((sum, r) => sum + r.revenue, 0);
  let acc = 0;
  for (const r of [...rows].sort((a, b) => b.revenue - a.revenue)) {
    if (r.revenue <= 0 || total <= 0) break;
    acc += r.revenue;
    r.abc = acc - r.revenue < total * 0.8 ? 'A' : acc - r.revenue < total * 0.95 ? 'B' : 'C';
  }
  const order: StockStatus[] = ['ruptura', 'comprar', 'atencao', 'parado', 'excesso', 'ok', 'sem_giro'];
  rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.revenue - a.revenue);
  return {
    days: q.days,
    storeId: q.storeId,
    coverTarget: q.coverTarget,
    totals: {
      stockValue: money(rows.reduce((s, r) => s + r.stockValue, 0)),
      idleValue: money(rows.filter((r) => r.status === 'parado').reduce((s, r) => s + r.stockValue, 0)),
      missing: rows.filter((r) => r.status === 'ruptura').length,
      toBuy: rows.filter((r) => r.suggested > 0).length,
      suggestedCost: money(rows.reduce((s, r) => s + r.suggestedCost, 0)),
      expiryRiskValue: money(rows.reduce((s, r) => s + (r.expiryRisk?.value ?? 0), 0)),
    },
    rows,
  };
}
