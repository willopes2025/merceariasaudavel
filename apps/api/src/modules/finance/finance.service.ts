import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LOSS_REASONS,
  addDays,
  monthlyDueDates,
  normalizeText,
  todayBR,
  type Page,
  type Payable,
  type PayableCategory,
  type PayableInput,
  type PayableListQuery,
  type PayableSummary,
  type PeriodReport,
  type LossReason,
  type ReportQuery,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';

const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** Meia-noite de Brasília daquele dia, como instante. */
const brStart = (iso: string) => new Date(`${iso}T00:00:00-03:00`);
const num = (v: Prisma.Decimal | null | undefined) => Number(v ?? 0);

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ contas a pagar

  async listPayables(ctx: RequestContext, q: PayableListQuery): Promise<Page<Payable> & { summary: PayableSummary }> {
    const today = asDate(todayBR());
    const scope: Prisma.PayableWhereInput = { tenantId: ctx.tenantId, ...(ctx.storeIds.length ? { OR: [{ storeId: null }, { storeId: { in: ctx.storeIds } }] } : {}) };
    const where: Prisma.PayableWhereInput = { AND: [scope] };
    if (q.status === 'overdue') Object.assign(where, { status: 'open', dueDate: { lt: today } });
    else if (q.status !== 'all') where.status = q.status;
    const words = q.q ? normalizeText(q.q).split(' ').filter(Boolean) : [];
    if (words.length) (where.AND as Prisma.PayableWhereInput[]).push(...words.map((w) => ({ searchText: { contains: w } })));
    const [total, rows, open, overdue, next] = await Promise.all([
      this.prisma.payable.count({ where }),
      this.prisma.payable.findMany({ where, orderBy: q.status === 'paid' ? { paidDate: 'desc' } : { dueDate: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.payable.aggregate({ where: { AND: [scope], status: 'open' }, _sum: { amount: true } }),
      this.prisma.payable.aggregate({ where: { AND: [scope], status: 'open', dueDate: { lt: today } }, _sum: { amount: true } }),
      this.prisma.payable.aggregate({ where: { AND: [scope], status: 'open', dueDate: { gte: today, lte: asDate(addDays(todayBR(), 7)) } }, _sum: { amount: true } }),
    ]);
    const stores = await this.storeNames(ctx);
    return {
      items: rows.map((r) => toPayable(r, stores)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      summary: { openAmount: num(open._sum.amount), overdueAmount: num(overdue._sum.amount), next7Days: num(next._sum.amount) },
    };
  }

  /** Cria a conta; com repetição, uma por mês. */
  async createPayable(ctx: RequestContext, input: PayableInput): Promise<Payable[]> {
    if (input.storeId) {
      if (!canUseStore(ctx, input.storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
      if (!(await this.prisma.store.count({ where: { id: input.storeId, tenantId: ctx.tenantId } }))) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
    }
    const dates = monthlyDueDates(input.dueDate, input.repeat);
    const created = await this.prisma.$transaction(async (tx) => {
      const out = [];
      for (const [i, due] of dates.entries()) {
        const description = input.repeat > 1 ? `${input.description} (${i + 1}/${input.repeat})` : input.description;
        out.push(
          await tx.payable.create({
            data: {
              tenantId: ctx.tenantId,
              storeId: input.storeId ?? null,
              description,
              supplier: input.supplier || null,
              category: input.category,
              amount: input.amount,
              dueDate: asDate(due),
              searchText: normalizeText([description, input.supplier].filter(Boolean).join(' ')),
              createdById: ctx.userId,
            },
          }),
        );
      }
      return out;
    });
    await this.audit.record(ctx, 'payable.create', 'payable', created[0]!.id, { description: input.description, count: created.length });
    const stores = await this.storeNames(ctx);
    return created.map((r) => toPayable(r, stores));
  }

  async payPayable(ctx: RequestContext, id: string, paidDate: string, note?: string | null): Promise<Payable> {
    if (paidDate > todayBR()) throw new DomainError('PAID_IN_FUTURE', 'A data do pagamento não pode ser no futuro.');
    const done = await this.prisma.payable.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'open' }, data: { status: 'paid', paidDate: asDate(paidDate), note: note ?? null } });
    if (!done.count) throw await this.notOpen(ctx, id);
    await this.audit.record(ctx, 'payable.pay', 'payable', id, { paidDate });
    return this.getPayable(ctx, id);
  }

  /** Cancelar uma conta em aberto, ou desfazer um pagamento lançado errado. */
  async setPayable(ctx: RequestContext, id: string, to: 'canceled' | 'open'): Promise<Payable> {
    const from = to === 'canceled' ? 'open' : { in: ['paid', 'canceled'] };
    const done = await this.prisma.payable.updateMany({ where: { id, tenantId: ctx.tenantId, status: from }, data: { status: to, ...(to === 'open' ? { paidDate: null, note: null } : {}) } });
    if (!done.count) throw await this.notOpen(ctx, id);
    await this.audit.record(ctx, to === 'canceled' ? 'payable.cancel' : 'payable.reopen', 'payable', id);
    return this.getPayable(ctx, id);
  }

  private async getPayable(ctx: RequestContext, id: string): Promise<Payable> {
    const r = await this.prisma.payable.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!r) throw new NotFoundError('conta', id);
    return toPayable(r, await this.storeNames(ctx));
  }

  private async notOpen(ctx: RequestContext, id: string) {
    const exists = await this.prisma.payable.count({ where: { id, tenantId: ctx.tenantId } });
    return exists ? new ConflictError('PAYABLE_STATE', 'Essa conta não está mais nessa situação. Atualize a tela.') : new NotFoundError('conta', id);
  }

  // ------------------------------------------------------------ resumo do período

  async report(ctx: RequestContext, q: ReportQuery): Promise<PeriodReport> {
    if (q.storeId && !canUseStore(ctx, q.storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
    const stores = q.storeId ? [q.storeId] : ctx.storeIds;
    const storeFilter = stores.length ? { storeId: { in: stores } } : {};
    const t = ctx.tenantId;
    const period = { gte: brStart(q.from), lt: brStart(addDays(q.to, 1)) };
    const dates = { gte: asDate(q.from), lte: asDate(q.to) };
    const storeSql = stores.length ? Prisma.sql`AND s.store_id IN (${Prisma.join(stores)})` : Prisma.empty;
    const moveStoreSql = stores.length ? Prisma.sql`AND m.store_id IN (SELECT COALESCE(stock_store_id, id) FROM store WHERE id IN (${Prisma.join(stores)}))` : Prisma.empty;

    const [sales, canceled, sellers, movements, paid, categories, losses] = await Promise.all([
      this.prisma.sale.aggregate({ where: { tenantId: t, ...storeFilter, createdAt: period, status: 'completed' }, _count: true, _sum: { total: true, cashbackUsed: true, cashbackEarned: true, memberSavings: true, costTotal: true } }),
      this.prisma.sale.count({ where: { tenantId: t, ...storeFilter, createdAt: period, status: 'canceled' } }),
      this.prisma.sale.groupBy({ by: ['sellerId'], where: { tenantId: t, ...storeFilter, createdAt: period, status: 'completed' }, _count: true, _sum: { total: true, cashbackUsed: true } }),
      this.prisma.cashMovement.groupBy({ by: ['methodId'], where: { tenantId: t, createdAt: period, type: { in: ['recebimento', 'estorno'] }, ...(stores.length ? { session: { storeId: { in: stores } } } : {}) }, _sum: { amount: true } }),
      this.prisma.payable.groupBy({ by: ['category'], where: { tenantId: t, status: 'paid', paidDate: dates, ...(stores.length ? { storeId: { in: stores } } : {}) }, _sum: { amount: true } }),
      this.prisma.$queryRaw<Array<{ name: string | null; total: Prisma.Decimal; cost: Prisma.Decimal }>>`
        SELECT c.name, SUM(i.total) AS total, SUM(i.quantity * i.unit_cost) AS cost
          FROM sale_item i JOIN sale s ON s.id = i.sale_id LEFT JOIN product_category c ON c.id = i.category_id
         WHERE s.tenant_id = ${t} AND s.status = 'completed' AND s.created_at >= ${period.gte} AND s.created_at < ${period.lt} ${storeSql}
         GROUP BY c.name ORDER BY total DESC`,
      this.prisma.$queryRaw<Array<{ reason: string | null; type: string; value: Prisma.Decimal }>>`
        SELECT m.reason, m.type, SUM(-m.delta * m.unit_cost) AS value FROM stock_movement m
         WHERE m.tenant_id = ${t} AND m.type IN ('perda', 'contagem') AND m.created_at >= ${period.gte} AND m.created_at < ${period.lt} ${moveStoreSql}
         GROUP BY m.reason, m.type`,
    ]);
    const memberRows = await this.prisma.sale.aggregate({ where: { tenantId: t, ...storeFilter, createdAt: period, status: 'completed', memberPricing: true }, _sum: { total: true, cashbackUsed: true } });

    const [methods, users] = await Promise.all([
      this.prisma.paymentMethod.findMany({ where: { tenantId: t }, select: { id: true, name: true } }),
      this.prisma.appUser.findMany({ where: { tenantId: t }, select: { id: true, name: true } }),
    ]);
    const methodName = new Map(methods.map((m) => [m.id, m.name]));
    const userName = new Map(users.map((u) => [u.id, u.name]));

    const count = sales._count;
    const total = num(sales._sum.total) + num(sales._sum.cashbackUsed);
    const memberTotal = num(memberRows._sum.total) + num(memberRows._sum.cashbackUsed);
    const byMethod = movements.map((m) => ({ name: m.methodId ? (methodName.get(m.methodId) ?? 'Outro') : 'Outro', amount: num(m._sum.amount) })).filter((m) => m.amount !== 0);
    const received = round(byMethod.reduce((s, m) => s + m.amount, 0));
    const paidTotal = round(paid.reduce((s, p) => s + num(p._sum.amount), 0));
    const lossRows = losses.map((l) => ({ reason: l.type === 'contagem' ? 'Diferença na contagem' : (LOSS_REASONS[l.reason as LossReason] ?? 'Outro'), amount: round(num(l.value)) })).filter((l) => l.amount !== 0);

    return {
      from: q.from,
      to: q.to,
      sales: {
        count,
        total: round(total),
        averageTicket: count ? round(total / count) : 0,
        canceled,
        memberShare: total ? Math.round((memberTotal / total) * 1000) / 10 : 0,
        memberSavings: round(num(sales._sum.memberSavings)),
        grossMargin: total ? Math.round(((total - num(sales._sum.costTotal)) / total) * 1000) / 10 : 0,
      },
      received: { total: received, byMethod: byMethod.sort((a, b) => b.amount - a.amount) },
      bySeller: sellers
        .map((s) => ({ name: s.sellerId ? (userName.get(s.sellerId) ?? '—') : 'Sem vendedor', count: s._count, total: round(num(s._sum.total) + num(s._sum.cashbackUsed)) }))
        .sort((a, b) => b.total - a.total),
      byCategory: categories.map((c) => ({ name: c.name ?? 'Sem categoria', total: round(num(c.total)), margin: num(c.total) ? Math.round(((num(c.total) - num(c.cost)) / num(c.total)) * 1000) / 10 : 0 })),
      losses: { total: round(lossRows.reduce((s, l) => s + l.amount, 0)), byReason: lossRows.sort((a, b) => b.amount - a.amount) },
      cashback: { earned: round(num(sales._sum.cashbackEarned)), used: round(num(sales._sum.cashbackUsed)) },
      payables: { paid: paidTotal, byCategory: paid.map((p) => ({ category: p.category as PayableCategory, amount: num(p._sum.amount) })).sort((a, b) => b.amount - a.amount) },
      result: round(received - paidTotal),
    };
  }

  private async storeNames(ctx: RequestContext): Promise<Map<string, string>> {
    const rows = await this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
    return new Map(rows.map((s) => [s.id, s.name]));
  }
}

const round = (v: number) => Math.round(v * 100) / 100;

function toPayable(r: Prisma.PayableGetPayload<object>, stores: Map<string, string>): Payable {
  const due = day(r.dueDate);
  return {
    id: r.id,
    description: r.description,
    supplier: r.supplier,
    category: r.category as PayableCategory,
    storeId: r.storeId,
    storeName: r.storeId ? (stores.get(r.storeId) ?? null) : null,
    amount: Number(r.amount),
    dueDate: due,
    status: r.status as Payable['status'],
    overdue: r.status === 'open' && due < todayBR(),
    paidDate: r.paidDate ? day(r.paidDate) : null,
    note: r.note,
  };
}
