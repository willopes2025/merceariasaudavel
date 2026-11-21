import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, GOAL_METRICS, todayBR, type Dashboard, type Goal, type GoalInput, type GoalMetric, type GoalScope, type TvData, type TvMode, type TvScreen, type TvScreenInput } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';
import { q3 } from '../products/stock';
import { brEnd, brStart, byHour, goalActual, goalStatus, kpis, lossValue, sellers, topProducts, type Window } from './metrics';

type GoalRow = Prisma.GoalGetPayload<object>;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1;
const money = (v: number) => Math.round(v * 100) / 100;
const monthOf = (day: string) => ({ start: `${day.slice(0, 7)}-01`, end: addDays(`${addDays(`${day.slice(0, 7)}-01`, 32).slice(0, 7)}-01`, -1) });

/** Metas, painel do dia e telas de TV. */
@Injectable()
export class ManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ metas

  async goals(ctx: RequestContext, current: boolean): Promise<Goal[]> {
    const today = new Date(`${todayBR()}T00:00:00Z`);
    const rows = await this.prisma.goal.findMany({
      where: { tenantId: ctx.tenantId, ...(current ? { active: true, startDate: { lte: today }, endDate: { gte: today } } : {}) },
      orderBy: [{ endDate: 'desc' }, { name: 'asc' }],
      take: 200,
    });
    return this.withProgress(ctx.tenantId, rows.filter((g) => !g.storeId || canUseStore(ctx, g.storeId)));
  }

  async saveGoal(ctx: RequestContext, id: string | null, input: GoalInput): Promise<Goal> {
    if (input.storeId && !(await this.prisma.store.count({ where: { id: input.storeId, tenantId: ctx.tenantId } }))) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
    if (input.refId) {
      const ok =
        input.scope === 'vendedor'
          ? await this.prisma.appUser.count({ where: { id: input.refId, tenantId: ctx.tenantId } })
          : input.scope === 'categoria'
            ? await this.prisma.productCategory.count({ where: { id: input.refId, tenantId: ctx.tenantId } })
            : await this.prisma.product.count({ where: { id: input.refId, tenantId: ctx.tenantId } });
      if (!ok) throw new DomainError('GOAL_REF_NOT_FOUND', 'Não achei a pessoa, a categoria ou o produto da meta.');
    }
    const data = {
      name: input.name,
      metric: input.metric,
      scope: input.scope,
      storeId: input.storeId,
      refId: input.scope === 'loja' ? null : input.refId,
      period: 'personalizado',
      startDate: new Date(`${input.startDate}T00:00:00Z`),
      endDate: new Date(`${input.endDate}T00:00:00Z`),
      target: input.target,
      active: input.active,
    };
    if (id) {
      if (!(await this.prisma.goal.count({ where: { id, tenantId: ctx.tenantId } }))) throw new NotFoundError('meta', id);
      await this.prisma.goal.update({ where: { id }, data });
    } else {
      id = (await this.prisma.goal.create({ data: { tenantId: ctx.tenantId, ...data } })).id;
    }
    await this.audit.record(ctx, 'goal.save', 'goal', id, { name: input.name, metric: input.metric, target: input.target });
    const row = await this.prisma.goal.findUniqueOrThrow({ where: { id } });
    return (await this.withProgress(ctx.tenantId, [row]))[0]!;
  }

  private async withProgress(tenantId: string, rows: GoalRow[]): Promise<Goal[]> {
    if (!rows.length) return [];
    const today = todayBR();
    const refs = rows.filter((g) => g.refId);
    const [stores, users, categories, products] = await Promise.all([
      this.prisma.store.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.prisma.appUser.findMany({ where: { tenantId, id: { in: refs.map((g) => g.refId!) } }, select: { id: true, name: true } }),
      this.prisma.productCategory.findMany({ where: { tenantId, id: { in: refs.map((g) => g.refId!) } }, select: { id: true, name: true } }),
      this.prisma.product.findMany({ where: { tenantId, id: { in: refs.map((g) => g.refId!) } }, select: { id: true, name: true } }),
    ]);
    const names = new Map([...users, ...categories, ...products].map((x) => [x.id, x.name]));
    return Promise.all(
      rows.map(async (g) => {
        const start = iso(g.startDate);
        const end = iso(g.endDate);
        const until = today < end ? today : end;
        const total = daysBetween(start, end);
        const passed = today < start ? 0 : Math.min(total, daysBetween(start, until));
        const elapsed = total ? passed / total : 1;
        const metric = g.metric as GoalMetric;
        const target = Number(g.target);
        const w: Window = { tenantId, from: brStart(start), to: brEnd(until), storeIds: g.storeId ? [g.storeId] : undefined };
        const actual = today < start ? 0 : await goalActual(this.prisma, { metric, scope: g.scope as GoalScope, refId: g.refId }, w);
        const cumulative = ['faturamento', 'vendas', 'novos_membros'].includes(metric);
        const daysLeft = Math.max(0, total - passed + (today <= end && today >= start ? 1 : 0));
        return {
          id: g.id,
          name: g.name,
          metric,
          scope: g.scope as GoalScope,
          storeId: g.storeId,
          storeName: g.storeId ? (stores.find((s) => s.id === g.storeId)?.name ?? null) : null,
          refId: g.refId,
          refName: g.refId ? (names.get(g.refId) ?? null) : null,
          startDate: start,
          endDate: end,
          target,
          active: g.active,
          progress: {
            actual,
            pct: target ? Math.round((actual / target) * 1000) / 1000 : 0,
            elapsed: Math.round(elapsed * 1000) / 1000,
            status: goalStatus(metric, actual, target, elapsed),
            perDayNeeded: cumulative && daysLeft > 0 && actual < target ? money((target - actual) / daysLeft) : null,
            projection: cumulative && elapsed > 0 ? money(actual / elapsed) : null,
          },
        };
      }),
    );
  }

  // ------------------------------------------------------------ painel

  async dashboard(ctx: RequestContext, storeId?: string): Promise<Dashboard> {
    if (storeId && !canUseStore(ctx, storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
    const storeIds = storeId ? [storeId] : ctx.storeIds.length ? ctx.storeIds : undefined;
    const day = todayBR();
    const now = new Date();
    const today: Window = { tenantId: ctx.tenantId, from: brStart(day), to: brEnd(day), storeIds };
    // Semana passada até a mesma hora: compara laranja com laranja.
    const lastWeekDay = addDays(day, -7);
    const lastWeek: Window = { tenantId: ctx.tenantId, from: brStart(lastWeekDay), to: new Date(brStart(lastWeekDay).getTime() + (now.getTime() - brStart(day).getTime())), storeIds };
    const month = monthOf(day);
    const monthW: Window = { tenantId: ctx.tenantId, from: brStart(month.start), to: brEnd(day), storeIds };

    const [todayK, lastWeekK, hours, monthK, top, sellerRows, goals, low, expiring, monthLosses, cashOpen] = await Promise.all([
      kpis(this.prisma, today),
      kpis(this.prisma, lastWeek),
      byHour(this.prisma, today),
      kpis(this.prisma, monthW),
      topProducts(this.prisma, today, 8),
      sellers(this.prisma, monthW),
      this.goals(ctx, true),
      this.lowStock(ctx.tenantId, storeIds),
      this.expiringLots(ctx.tenantId, storeIds, 15),
      lossValue(this.prisma, monthW),
      this.prisma.cashSession.count({ where: { tenantId: ctx.tenantId, status: 'open', ...(storeIds ? { storeId: { in: storeIds } } : {}) } }),
    ]);
    const monthGoal = goals.find((g) => g.metric === 'faturamento' && g.scope === 'loja' && (!storeId || !g.storeId || g.storeId === storeId) && g.startDate <= month.start && g.endDate >= month.end);
    const daysInMonth = daysBetween(month.start, month.end);
    const passed = daysBetween(month.start, day);
    return {
      storeId: storeId ?? null,
      day,
      today: todayK,
      lastWeek: lastWeekK,
      byHour: hours,
      month: { total: monthK.total, count: monthK.count, target: monthGoal?.target ?? null, projection: money((monthK.total / passed) * daysInMonth), daysLeft: daysInMonth - passed + 1 },
      topProducts: top,
      sellers: sellerRows,
      goals,
      alerts: { lowStock: low, expiring, monthLosses, cashOpen: cashOpen > 0 },
    };
  }

  private async lowStock(tenantId: string, storeIds?: string[]) {
    const storeFilter = storeIds?.length ? Prisma.sql`AND b.store_id IN (SELECT COALESCE(stock_store_id, id) FROM store WHERE id IN (${Prisma.join(storeIds)}))` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string; unit: string; min_stock: Prisma.Decimal; qty: Prisma.Decimal | null }>>`
      SELECT p.id, p.name, p.unit, p.min_stock, (SELECT SUM(b.quantity) FROM stock_balance b WHERE b.product_id = p.id ${storeFilter}) AS qty
        FROM product p WHERE p.tenant_id = ${tenantId} AND p.active AND p.track_stock AND p.min_stock > 0
         AND COALESCE((SELECT SUM(b.quantity) FROM stock_balance b WHERE b.product_id = p.id ${storeFilter}), 0) < p.min_stock
       ORDER BY COALESCE((SELECT SUM(b.quantity) FROM stock_balance b WHERE b.product_id = p.id ${storeFilter}), 0) / p.min_stock ASC LIMIT 15`;
    return rows.map((r) => ({ productId: r.id, name: r.name, quantity: q3(r.qty), minStock: q3(r.min_stock), unit: r.unit }));
  }

  private async expiringLots(tenantId: string, storeIds: string[] | undefined, days: number) {
    const today = todayBR();
    const lots = await this.prisma.stockLot.findMany({
      where: { tenantId, quantity: { gt: 0 }, expiresAt: { not: null, lte: new Date(`${addDays(today, days)}T00:00:00Z`) }, ...(storeIds ? { storeId: { in: storeIds } } : {}) },
      include: { product: { select: { name: true, cost: true } } },
      orderBy: { expiresAt: 'asc' },
      take: 15,
    });
    return lots.map((l) => ({
      productId: l.productId,
      name: l.product.name,
      lotCode: l.code,
      expiresAt: iso(l.expiresAt!),
      daysLeft: daysBetween(today, iso(l.expiresAt!)) - 1,
      quantity: q3(l.quantity),
      value: money(Number(l.quantity) * Number(l.product.cost)),
    }));
  }

  // ------------------------------------------------------------ TV

  async tvScreens(ctx: RequestContext): Promise<TvScreen[]> {
    const rows = await this.prisma.tvScreen.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'asc' } });
    const stores = await this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
    return rows.map((r) => ({ id: r.id, storeId: r.storeId, storeName: stores.find((s) => s.id === r.storeId)?.name ?? '', name: r.name, mode: r.mode as TvMode, active: r.active, path: `/tv/${r.token}` }));
  }

  async saveTv(ctx: RequestContext, id: string | null, input: TvScreenInput, rotate = false): Promise<TvScreen> {
    if (!(await this.prisma.store.count({ where: { id: input.storeId, tenantId: ctx.tenantId } }))) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
    const token = randomBytes(24).toString('base64url');
    if (id) {
      if (!(await this.prisma.tvScreen.count({ where: { id, tenantId: ctx.tenantId } }))) throw new NotFoundError('tela de TV', id);
      await this.prisma.tvScreen.update({ where: { id }, data: { ...input, ...(rotate ? { token } : {}) } });
    } else {
      id = (await this.prisma.tvScreen.create({ data: { tenantId: ctx.tenantId, ...input, token } })).id;
    }
    await this.audit.record(ctx, rotate ? 'tv.rotate' : 'tv.save', 'tv_screen', id, { name: input.name, mode: input.mode });
    return (await this.tvScreens(ctx)).find((t) => t.id === id)!;
  }

  /**
   * O que a TV mostra. Rota pública: só o token do link abre, e não sai nenhum
   * dado pessoal de cliente (nem nome) — só números da loja e primeiro nome da equipe.
   */
  async tvData(token: string): Promise<TvData> {
    const screen = /^[\w-]{20,64}$/.test(token) ? await this.prisma.tvScreen.findUnique({ where: { token } }) : null;
    if (!screen || !screen.active) throw new NotFoundError('tela de TV');
    const store = await this.prisma.store.findUnique({ where: { id: screen.storeId }, select: { name: true } });
    const day = todayBR();
    const month = monthOf(day);
    const storeIds = [screen.storeId];
    const todayW: Window = { tenantId: screen.tenantId, from: brStart(day), to: brEnd(day), storeIds };
    const monthW: Window = { tenantId: screen.tenantId, from: brStart(month.start), to: brEnd(day), storeIds };
    const beforeToday: Window = { tenantId: screen.tenantId, from: brStart(month.start), to: brStart(day), storeIds };
    const todayDate = new Date(`${day}T00:00:00Z`);
    const [todayK, monthK, beforeK, ranking, hours, goalRows, offers] = await Promise.all([
      kpis(this.prisma, todayW),
      kpis(this.prisma, monthW),
      kpis(this.prisma, beforeToday),
      sellers(this.prisma, todayW),
      byHour(this.prisma, todayW),
      this.prisma.goal.findMany({ where: { tenantId: screen.tenantId, active: true, startDate: { lte: todayDate }, endDate: { gte: todayDate }, OR: [{ storeId: null }, { storeId: screen.storeId }] }, orderBy: { name: 'asc' }, take: 8 }),
      // As maiores economias de membro (em %), calculadas no banco.
      this.prisma.$queryRaw<Array<{ name: string; price: Prisma.Decimal; memberPrice: Prisma.Decimal }>>`
        SELECT name, price, member_price AS "memberPrice" FROM product
         WHERE tenant_id = ${screen.tenantId} AND active AND sellable AND show_in_app AND kind <> 'insumo'
           AND member_price IS NOT NULL AND price > 0 AND member_price < price
         ORDER BY (price - member_price) / price DESC, name LIMIT 12`,
    ]);
    const goals = await this.withProgress(screen.tenantId, goalRows);
    const monthGoal = goals.find((g) => g.metric === 'faturamento' && g.scope === 'loja' && g.startDate <= month.start && g.endDate >= month.end);
    const daysLeft = daysBetween(day, month.end);
    const daysInMonth = daysBetween(month.start, month.end);
    return {
      name: screen.name,
      storeName: store?.name ?? '',
      mode: screen.mode as TvMode,
      now: new Date().toISOString(),
      today: { total: todayK.total, count: todayK.count, ticket: todayK.ticket, memberShare: todayK.memberShare },
      dayTarget: monthGoal ? money(Math.max(0, monthGoal.target - beforeK.total) / Math.max(1, daysLeft)) : null,
      month: { total: monthK.total, target: monthGoal?.target ?? null, projection: money((monthK.total / daysBetween(month.start, day)) * daysInMonth) },
      ranking: ranking.map((r) => ({ name: r.name.split(' ')[0] ?? r.name, total: r.total, count: r.count })),
      byHour: hours.map((h) => ({ hour: h.hour, total: h.total })),
      goals: goals.map((g) => ({ name: g.name, pct: g.progress.pct, status: g.progress.status, actual: g.progress.actual, target: g.target, unit: GOAL_METRICS[g.metric].unit })),
      offers: offers
        .map((o) => ({ name: o.name, price: Number(o.price), memberPrice: Number(o.memberPrice), savingPct: Math.round((1 - Number(o.memberPrice) / Number(o.price)) * 100) }))
        .filter((o) => o.memberPrice < o.price)
        .sort((a, b) => b.savingPct - a.savingPct)
        .slice(0, 12),
      refreshSeconds: 60,
    };
  }
}
