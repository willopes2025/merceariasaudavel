import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_PAYMENT_METHODS,
  type CashCloseInput,
  type CashManualInput,
  type CashMovement,
  type CashOpenInput,
  type CashSession,
  type CashSessionRow,
  type Page,
  type PaymentKind,
  type PaymentMethod,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';

type Tx = Prisma.TransactionClient;
const cents = (v: Prisma.Decimal | number | null) => Math.round(Number(v ?? 0) * 100);

const sessionInclude = {
  store: { select: { name: true } },
  sales: { where: { status: 'completed' }, select: { total: true } },
  movements: {
    orderBy: { createdAt: 'desc' },
    include: {
      method: { select: { name: true, kind: true } },
      sale: { select: { number: true, customer: { select: { name: true } } } },
      reversal: { select: { id: true } },
    },
  },
} satisfies Prisma.CashSessionInclude;
type SessionRow = Prisma.CashSessionGetPayload<{ include: typeof sessionInclude }>;

/**
 * Caixa da loja. Regras que o banco também garante: um caixa aberto por loja
 * (índice único) e lançamento só de inserção (sem UPDATE/DELETE para a aplicação).
 */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ formas de pagamento

  async methods(ctx: RequestContext): Promise<PaymentMethod[]> {
    if (!(await this.prisma.paymentMethod.count({ where: { tenantId: ctx.tenantId } }))) {
      await this.prisma.paymentMethod.createMany({ data: DEFAULT_PAYMENT_METHODS.map((m) => ({ tenantId: ctx.tenantId, ...m })), skipDuplicates: true });
    }
    const rows = await this.prisma.paymentMethod.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } });
    const order = ['dinheiro', 'pix', 'debito', 'credito', 'outro'];
    return rows
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
      .map((m) => ({ id: m.id, name: m.name, kind: m.kind as PaymentKind, active: m.active }));
  }

  // ------------------------------------------------------------ consulta

  async current(ctx: RequestContext, storeId: string): Promise<CashSession | null> {
    this.assertStore(ctx, storeId);
    const row = await this.prisma.cashSession.findFirst({ where: { tenantId: ctx.tenantId, storeId, status: 'open' }, include: sessionInclude });
    return row ? this.toSession(row) : null;
  }

  async get(ctx: RequestContext, id: string): Promise<CashSession> {
    const row = await this.prisma.cashSession.findFirst({ where: { id, tenantId: ctx.tenantId }, include: sessionInclude });
    if (!row || !canUseStore(ctx, row.storeId)) throw new NotFoundError('caixa', id);
    return this.toSession(row);
  }

  async history(ctx: RequestContext, storeId: string | undefined, page: number): Promise<Page<CashSessionRow>> {
    const pageSize = 20;
    const where: Prisma.CashSessionWhereInput = {
      tenantId: ctx.tenantId,
      ...(storeId ? { storeId } : {}),
      ...(ctx.storeIds.length ? { AND: [{ storeId: { in: ctx.storeIds } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.cashSession.count({ where }),
      this.prisma.cashSession.findMany({ where, include: sessionInclude, orderBy: { openedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const sessions = await Promise.all(rows.map((r) => this.toSession(r)));
    return {
      items: sessions.map((s) => ({ id: s.id, storeName: s.storeName, status: s.status, openedAt: s.openedAt, closedAt: s.closedAt, openedByName: s.openedByName, received: s.received, difference: s.difference })),
      total,
      page,
      pageSize,
    };
  }

  // ------------------------------------------------------------ abrir, movimentar, fechar

  async open(ctx: RequestContext, input: CashOpenInput): Promise<CashSession> {
    this.assertStore(ctx, input.storeId);
    if (!(await this.prisma.store.count({ where: { id: input.storeId, tenantId: ctx.tenantId } }))) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
    try {
      const row = await this.prisma.cashSession.create({
        data: { tenantId: ctx.tenantId, storeId: input.storeId, openedById: ctx.userId, openingAmount: input.openingAmount },
      });
      await this.audit.record(ctx, 'cash.open', 'cash_session', row.id, { openingAmount: input.openingAmount });
      return this.get(ctx, row.id);
    } catch (e) {
      // Índice único: duas pessoas abrindo ao mesmo tempo, só uma consegue.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictError('CASH_ALREADY_OPEN', 'Já existe um caixa aberto nesta loja.');
      throw e;
    }
  }

  async manual(ctx: RequestContext, sessionId: string, input: CashManualInput): Promise<CashSession> {
    await this.prisma.$transaction(async (tx) => {
      const session = await this.lockOpen(tx, ctx, sessionId);
      if (input.type === 'sangria') {
        const inDrawer = await this.expectedCashCents(tx, session.id, cents(session.opening_amount));
        if (cents(input.amount) > inDrawer) throw new DomainError('NOT_ENOUGH_CASH', 'Não há esse valor em dinheiro na gaveta.');
      }
      await tx.cashMovement.create({
        data: { tenantId: ctx.tenantId, sessionId, type: input.type, amount: input.type === 'sangria' ? -input.amount : input.amount, note: input.note, userId: ctx.userId },
      });
    });
    return this.get(ctx, sessionId);
  }

  async close(ctx: RequestContext, sessionId: string, input: CashCloseInput): Promise<CashSession> {
    await this.prisma.$transaction(async (tx) => {
      const session = await this.lockOpen(tx, ctx, sessionId);
      const expected = await this.expectedCashCents(tx, session.id, cents(session.opening_amount));
      await tx.cashSession.update({
        where: { id: sessionId },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closedById: ctx.userId,
          expectedCash: expected / 100,
          countedAmount: input.countedAmount,
          difference: (cents(input.countedAmount) - expected) / 100,
          notes: input.notes ?? null,
        },
      });
    });
    const closed = await this.get(ctx, sessionId);
    await this.audit.record(ctx, 'cash.close', 'cash_session', sessionId, { difference: closed.difference });
    return closed;
  }

  // ------------------------------------------------------------ usado pela venda

  /** Caixa aberto da loja, travado para a transação. Sem caixa aberto, não vende. */
  async lockOpenOf(tx: Tx, ctx: RequestContext, storeId: string) {
    const session = await tx.cashSession.findFirst({ where: { tenantId: ctx.tenantId, storeId, status: 'open' }, select: { id: true } });
    if (!session) throw new ConflictError('CASH_CLOSED', 'Abra o caixa da loja antes de vender.');
    return this.lockOpen(tx, ctx, session.id);
  }

  /** Dinheiro que deve estar na gaveta agora (em centavos). */
  async drawerCents(tx: Tx, session: { id: string; opening_amount: Prisma.Decimal }): Promise<number> {
    return this.expectedCashCents(tx, session.id, cents(session.opening_amount));
  }

  // ------------------------------------------------------------ apoio

  private assertStore(ctx: RequestContext, storeId: string) {
    if (!canUseStore(ctx, storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
  }

  /** Trava o caixa e confere que está aberto: fechar e lançar ao mesmo tempo não se atropelam. */
  async lockOpen(tx: Tx, ctx: RequestContext, sessionId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; store_id: string; status: string; opening_amount: Prisma.Decimal }>>`
      SELECT id, store_id, status, opening_amount FROM cash_session WHERE id = ${sessionId} AND tenant_id = ${ctx.tenantId} FOR UPDATE`;
    const session = rows[0];
    if (!session || !canUseStore(ctx, session.store_id)) throw new NotFoundError('caixa', sessionId);
    if (session.status !== 'open') throw new ConflictError('CASH_CLOSED', 'Esse caixa já foi fechado.');
    return session;
  }

  /** Dinheiro que deve estar na gaveta: troco + o que entrou e saiu em dinheiro. */
  private async expectedCashCents(tx: Tx, sessionId: string, openingCents: number): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
      SELECT COALESCE(SUM(m.amount), 0) AS total
        FROM cash_movement m LEFT JOIN payment_method p ON p.id = m.method_id
       WHERE m.session_id = ${sessionId} AND (m.method_id IS NULL OR p.kind = 'dinheiro')`;
    return openingCents + cents(rows[0]?.total ?? 0);
  }

  private async toSession(r: SessionRow): Promise<CashSession> {
    const userIds = [...new Set([r.openedById, r.closedById, ...r.movements.map((m) => m.userId)].filter((v): v is string => Boolean(v)))];
    const users = await this.prisma.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    const byMethod = new Map<string, { methodName: string; kind: PaymentKind; cents: number }>();
    let cash = cents(r.openingAmount);
    for (const m of r.movements) {
      if (!m.method || m.method.kind === 'dinheiro') cash += cents(m.amount);
      if (m.method) {
        const entry = byMethod.get(m.method.name) ?? { methodName: m.method.name, kind: m.method.kind as PaymentKind, cents: 0 };
        entry.cents += cents(m.amount);
        byMethod.set(m.method.name, entry);
      }
    }
    const totals = [...byMethod.values()].map((t) => ({ methodName: t.methodName, kind: t.kind, amount: t.cents / 100 }));
    const movements: CashMovement[] = r.movements.map((m) => ({
      id: m.id,
      type: m.type as CashMovement['type'],
      amount: Number(m.amount),
      methodName: m.method?.name ?? null,
      methodKind: (m.method?.kind as PaymentKind | undefined) ?? null,
      saleId: m.saleId,
      saleNumber: m.sale?.number ?? null,
      customerName: m.sale?.customer?.name ?? null,
      note: m.note,
      userName: name.get(m.userId) ?? null,
      at: m.createdAt.toISOString(),
      reversed: Boolean(m.reversal),
    }));
    return {
      id: r.id,
      storeId: r.storeId,
      storeName: r.store.name,
      status: r.status as 'open' | 'closed',
      openedAt: r.openedAt.toISOString(),
      openedByName: name.get(r.openedById) ?? null,
      openingAmount: Number(r.openingAmount),
      closedAt: r.closedAt?.toISOString() ?? null,
      closedByName: r.closedById ? (name.get(r.closedById) ?? null) : null,
      expectedCash: r.status === 'closed' && r.expectedCash != null ? Number(r.expectedCash) : cash / 100,
      countedAmount: r.countedAmount == null ? null : Number(r.countedAmount),
      difference: r.difference == null ? null : Number(r.difference),
      notes: r.notes,
      sales: { count: r.sales.length, total: r.sales.reduce((s, x) => s + cents(x.total), 0) / 100 },
      totals,
      received: totals.reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100,
      movements,
    };
  }
}
