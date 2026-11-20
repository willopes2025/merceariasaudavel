import { Prisma } from '@prisma/client';
import { GOAL_METRICS, type DashboardKpis, type GoalMetric, type GoalScope, type GoalStatus } from '@mercearia/contracts';
import type { PrismaService } from '../../common/prisma/prisma.service';

/** Início do dia em Brasília (o servidor roda em UTC). */
export const brStart = (iso: string) => new Date(`${iso}T00:00:00-03:00`);
export const brEnd = (iso: string) => new Date(brStart(iso).getTime() + 86_400_000);
const money = (v: number) => Math.round(v * 100) / 100;

export interface Window {
  tenantId: string;
  from: Date;
  to: Date;
  /** Vazio = todas as lojas. */
  storeIds?: string[];
}

const stores = (w: Window, col = Prisma.sql`s.store_id`) => (w.storeIds?.length ? Prisma.sql`AND ${col} IN (${Prisma.join(w.storeIds)})` : Prisma.empty);

/**
 * Faturamento = o que a venda valeu em mercadoria (pago + cashback usado),
 * sem as canceladas. É a mesma conta no painel, nas metas e na TV.
 */
export async function kpis(db: PrismaService, w: Window, sellerId?: string): Promise<DashboardKpis> {
  const seller = sellerId ? Prisma.sql`AND s.seller_id = ${sellerId}` : Prisma.empty;
  const [row] = await db.$queryRaw<Array<{ count: bigint; total: Prisma.Decimal | null; member: Prisma.Decimal | null; items: Prisma.Decimal | null; cashback: Prisma.Decimal | null }>>`
    SELECT COUNT(*) AS count, SUM(s.total + s.cashback_used) AS total,
           SUM(CASE WHEN s.member_pricing THEN s.total + s.cashback_used ELSE 0 END) AS member,
           SUM(s.items_count) AS items, SUM(s.cashback_earned) AS cashback
      FROM sale s
     WHERE s.tenant_id = ${w.tenantId} AND s.status = 'completed' AND s.created_at >= ${w.from} AND s.created_at < ${w.to} ${stores(w)} ${seller}`;
  const count = Number(row?.count ?? 0);
  const total = Number(row?.total ?? 0);
  const newMembers = await membersJoined(db, w, sellerId);
  return {
    total: money(total),
    count,
    ticket: count ? money(total / count) : 0,
    itemsPerSale: count ? Math.round((Number(row?.items ?? 0) / count) * 10) / 10 : 0,
    memberShare: total ? Math.round((Number(row?.member ?? 0) / total) * 1000) / 10 : 0,
    newMembers,
    cashbackEarned: money(Number(row?.cashback ?? 0)),
  };
}

/** Quem entrou no clube no período (pela trilha de auditoria: quem cadastrou e quando). */
export async function membersJoined(db: PrismaService, w: Window, userId?: string): Promise<number> {
  const user = userId ? Prisma.sql`AND a.user_id = ${userId}` : Prisma.empty;
  const storeFilter = w.storeIds?.length ? Prisma.sql`AND (c.store_id IS NULL OR c.store_id IN (${Prisma.join(w.storeIds)}))` : Prisma.empty;
  const [row] = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT a.entity_id) AS n FROM audit_log a JOIN customer c ON c.id = a.entity_id
     WHERE a.tenant_id = ${w.tenantId} AND a.action = 'customer.member' AND a.created_at >= ${w.from} AND a.created_at < ${w.to} ${user} ${storeFilter}`;
  return Number(row?.n ?? 0);
}

export async function byHour(db: PrismaService, w: Window): Promise<Array<{ hour: number; total: number; count: number }>> {
  const rows = await db.$queryRaw<Array<{ hour: number; total: Prisma.Decimal; count: bigint }>>`
    SELECT EXTRACT(HOUR FROM s.created_at - INTERVAL '3 hours')::int AS hour, SUM(s.total + s.cashback_used) AS total, COUNT(*) AS count
      FROM sale s WHERE s.tenant_id = ${w.tenantId} AND s.status = 'completed' AND s.created_at >= ${w.from} AND s.created_at < ${w.to} ${stores(w)}
     GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ hour: Number(r.hour), total: money(Number(r.total)), count: Number(r.count) }));
}

export async function sellers(db: PrismaService, w: Window): Promise<Array<{ userId: string; name: string; total: number; count: number }>> {
  const rows = await db.$queryRaw<Array<{ id: string; name: string; total: Prisma.Decimal; count: bigint }>>`
    SELECT u.id, u.name, SUM(s.total + s.cashback_used) AS total, COUNT(*) AS count
      FROM sale s JOIN app_user u ON u.id = s.seller_id
     WHERE s.tenant_id = ${w.tenantId} AND s.status = 'completed' AND s.created_at >= ${w.from} AND s.created_at < ${w.to} ${stores(w)}
     GROUP BY u.id, u.name ORDER BY total DESC LIMIT 10`;
  return rows.map((r) => ({ userId: r.id, name: r.name, total: money(Number(r.total)), count: Number(r.count) }));
}

export async function topProducts(db: PrismaService, w: Window, limit = 10) {
  const rows = await db.$queryRaw<Array<{ product_id: string; name: string; unit: string; qty: Prisma.Decimal; total: Prisma.Decimal }>>`
    SELECT i.product_id, MAX(i.description) AS name, MAX(i.unit) AS unit, SUM(i.quantity) AS qty, SUM(i.total) AS total
      FROM sale_item i JOIN sale s ON s.id = i.sale_id
     WHERE s.tenant_id = ${w.tenantId} AND s.status = 'completed' AND s.created_at >= ${w.from} AND s.created_at < ${w.to} ${stores(w)}
     GROUP BY i.product_id ORDER BY total DESC LIMIT ${limit}`;
  return rows.map((r) => ({ productId: r.product_id, name: r.name, quantity: Math.round(Number(r.qty) * 1000) / 1000, unit: r.unit, total: money(Number(r.total)) }));
}

/** Valor da meta no período (o "realizado"). */
export async function goalActual(db: PrismaService, g: { metric: GoalMetric; scope: GoalScope; refId: string | null }, w: Window): Promise<number> {
  if (g.scope === 'categoria' || g.scope === 'produto') {
    const filter = g.scope === 'categoria' ? Prisma.sql`AND i.category_id = ${g.refId}` : Prisma.sql`AND i.product_id = ${g.refId}`;
    const [row] = await db.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
      SELECT SUM(i.total) AS total FROM sale_item i JOIN sale s ON s.id = i.sale_id
       WHERE s.tenant_id = ${w.tenantId} AND s.status = 'completed' AND s.created_at >= ${w.from} AND s.created_at < ${w.to} ${stores(w)} ${filter}`;
    return money(Number(row?.total ?? 0));
  }
  if (g.metric === 'perda_insumos') return lossPct(db, w);
  const k = await kpis(db, w, g.scope === 'vendedor' ? (g.refId ?? undefined) : undefined);
  switch (g.metric) {
    case 'faturamento':
      return k.total;
    case 'vendas':
      return k.count;
    case 'ticket':
      return k.ticket;
    case 'itens_por_venda':
      return k.itemsPerSale;
    case 'novos_membros':
      return k.newMembers;
    default:
      return 0;
  }
}

/** % de perda dos insumos: (perdas + faltas na contagem) ÷ (uso previsto pelas fichas + perdas), em valor. */
export async function lossPct(db: PrismaService, w: Window): Promise<number> {
  const storeFilter = w.storeIds?.length ? Prisma.sql`AND m.store_id IN (${Prisma.join(w.storeIds)})` : Prisma.empty;
  const [row] = await db.$queryRaw<Array<{ used: Prisma.Decimal | null; lost: Prisma.Decimal | null }>>`
    SELECT SUM(CASE WHEN m.type IN ('consumo', 'consumo_estorno') THEN -m.delta * m.unit_cost ELSE 0 END) AS used,
           SUM(CASE WHEN m.type IN ('perda', 'contagem') THEN -m.delta * m.unit_cost ELSE 0 END) AS lost
      FROM stock_movement m JOIN product p ON p.id = m.product_id
     WHERE m.tenant_id = ${w.tenantId} AND m.created_at >= ${w.from} AND m.created_at < ${w.to} ${storeFilter}
       AND (p.kind = 'insumo' OR EXISTS (SELECT 1 FROM recipe_item r WHERE r.ingredient_id = p.id))`;
  const used = Number(row?.used ?? 0);
  const lost = Math.max(0, Number(row?.lost ?? 0));
  return used + lost > 0 ? Math.round((lost / (used + lost)) * 1000) / 10 : 0;
}

/** Valor a custo das perdas lançadas no período. */
export async function lossValue(db: PrismaService, w: Window): Promise<number> {
  const storeFilter = w.storeIds?.length ? Prisma.sql`AND m.store_id IN (${Prisma.join(w.storeIds)})` : Prisma.empty;
  const [row] = await db.$queryRaw<Array<{ v: Prisma.Decimal | null }>>`
    SELECT SUM(-m.delta * m.unit_cost) AS v FROM stock_movement m
     WHERE m.tenant_id = ${w.tenantId} AND m.type = 'perda' AND m.created_at >= ${w.from} AND m.created_at < ${w.to} ${storeFilter}`;
  return money(Number(row?.v ?? 0));
}

/** Situação da meta: no ritmo (verde), um pouco atrás (amarelo) ou longe (vermelho). */
export function goalStatus(metric: GoalMetric, actual: number, target: number, elapsed: number): GoalStatus {
  const higher = GOAL_METRICS[metric].higherIsBetter;
  if (!higher) return actual <= target ? 'green' : actual <= target * 1.2 ? 'yellow' : 'red';
  const pct = target ? actual / target : 0;
  // Médias (ticket, itens por venda) não acumulam: comparam direto com o alvo.
  const pace = metric === 'ticket' || metric === 'itens_por_venda' ? 1 : Math.max(elapsed, 0.0001);
  if (pct >= 1 || pct >= pace * 0.95) return 'green';
  if (pct >= pace * 0.8) return 'yellow';
  return 'red';
}
