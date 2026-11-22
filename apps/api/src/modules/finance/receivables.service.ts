import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SALE_CHANNELS,
  addDays,
  financeConfigSchema,
  todayBR,
  type FinanceConfig,
  type PaymentFeesInput,
  type PaymentMethodFees,
  type Receivable,
  type ReceivableManualInput,
  type ReceivableQuery,
  type ReceivableSettleInput,
  type ReceivablesSummary,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const num = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const SP = Prisma.raw(`AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'`);

/**
 * Contas a receber. Cada pagamento de venda (recebimento ou estorno no caixa) vira um recebível com a taxa e o
 * prazo da forma de pagamento: Pix e dinheiro caem na hora; cartão cai no prazo da maquininha, já sem a taxa.
 * Os recebíveis são criados sob demanda (sempre que o financeiro é consultado), então nunca ficam faltando.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Cria os recebíveis que faltam, cancela os pares venda/estorno que nem chegaram a cair e dá baixa no que já caiu. */
  async sync(tenantId: string) {
    const hoje = asDate(todayBR());
    await this.prisma.$executeRaw`
      INSERT INTO receivable (id, tenant_id, store_id, movement_id, sale_id, method_id, kind, description, gross, fee, net, sale_date, due_date, status, received_date, received_amount)
      SELECT gen_random_uuid()::text, m.tenant_id, cs.store_id, m.id, m.sale_id, m.method_id,
             CASE WHEN m.type = 'estorno' THEN 'estorno' ELSE 'venda' END,
             CASE WHEN s.number IS NULL THEN COALESCE(NULLIF(m.note, ''), 'Recebimento no caixa')
                  WHEN m.type = 'estorno' THEN 'Estorno da venda nº ' || s.number ELSE 'Venda nº ' || s.number END,
             m.amount, f.fee, m.amount - f.fee, x.d, x.d + pm.settle_days,
             CASE WHEN pm.settle_days = 0 THEN 'recebido' ELSE 'aberto' END,
             CASE WHEN pm.settle_days = 0 THEN x.d END,
             CASE WHEN pm.settle_days = 0 THEN m.amount - f.fee END
        FROM cash_movement m
        JOIN cash_session cs ON cs.id = m.session_id
        JOIN payment_method pm ON pm.id = m.method_id
        LEFT JOIN sale s ON s.id = m.sale_id
        CROSS JOIN LATERAL (SELECT (m.created_at ${SP})::date AS d) x
        CROSS JOIN LATERAL (SELECT CASE WHEN m.amount > 0 THEN ROUND(m.amount * pm.fee_pct / 100 + pm.fee_fixed, 2) ELSE 0 END AS fee) f
       WHERE m.tenant_id = ${tenantId} AND m.type IN ('recebimento', 'estorno') AND m.method_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM receivable r WHERE r.movement_id = m.id)
      ON CONFLICT (movement_id) DO NOTHING`;
    // Venda cancelada antes do dinheiro cair: a venda e o estorno se anulam.
    await this.prisma.$executeRaw`
      WITH pares AS (
        SELECT r.id AS a, re.id AS b FROM receivable re
          JOIN cash_movement e ON e.id = re.movement_id
          JOIN receivable r ON r.movement_id = e.reverses_id
         WHERE re.tenant_id = ${tenantId} AND re.kind = 'estorno' AND re.status = 'aberto' AND r.status = 'aberto')
      UPDATE receivable SET status = 'cancelado', note = 'Venda cancelada antes de cair'
       WHERE id IN (SELECT a FROM pares UNION SELECT b FROM pares)`;
    // Formas que não exigem conferir o extrato: baixa sozinha no dia previsto.
    await this.prisma.$executeRaw`
      UPDATE receivable r SET status = 'recebido', received_date = r.due_date, received_amount = r.net
        FROM payment_method pm
       WHERE r.method_id = pm.id AND r.tenant_id = ${tenantId} AND r.status = 'aberto' AND NOT pm.reconcile AND r.due_date <= ${hoje}`;
  }

  async summary(ctx: RequestContext): Promise<ReceivablesSummary> {
    await this.sync(ctx.tenantId);
    const t = ctx.tenantId;
    const hoje = todayBR();
    const store = this.storeSql(ctx);
    const [tot] = await this.prisma.$queryRaw<Array<{ today: Prisma.Decimal; next7: Prisma.Decimal; next30: Prisma.Decimal; overdue: Prisma.Decimal; open: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(net) FILTER (WHERE due_date = ${asDate(hoje)}), 0) AS today,
             COALESCE(SUM(net) FILTER (WHERE due_date >= ${asDate(hoje)} AND due_date <= ${asDate(addDays(hoje, 7))}), 0) AS next7,
             COALESCE(SUM(net) FILTER (WHERE due_date >= ${asDate(hoje)} AND due_date <= ${asDate(addDays(hoje, 30))}), 0) AS next30,
             COALESCE(SUM(net) FILTER (WHERE due_date < ${asDate(hoje)}), 0) AS overdue,
             COALESCE(SUM(net), 0) AS open
        FROM receivable r WHERE tenant_id = ${t} AND status = 'aberto' ${store}`;
    const [fees] = await this.prisma.$queryRaw<Array<{ fee: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(fee), 0) AS fee FROM receivable r WHERE tenant_id = ${t} AND kind = 'venda' AND status <> 'cancelado' AND sale_date >= ${asDate(hoje.slice(0, 8) + '01')} ${store}`;
    const metodos = await this.prisma.$queryRaw<Array<{ name: string | null; open: Prisma.Decimal; overdue: Prisma.Decimal; next: Date | null }>>`
      SELECT pm.name, SUM(r.net) AS open, COALESCE(SUM(r.net) FILTER (WHERE r.due_date < ${asDate(hoje)}), 0) AS overdue, MIN(r.due_date) FILTER (WHERE r.due_date >= ${asDate(hoje)}) AS next
        FROM receivable r LEFT JOIN payment_method pm ON pm.id = r.method_id
       WHERE r.tenant_id = ${t} AND r.status = 'aberto' ${store}
       GROUP BY pm.name ORDER BY 2 DESC`;
    return {
      today: num(tot?.today),
      next7: num(tot?.next7),
      next30: num(tot?.next30),
      overdue: num(tot?.overdue),
      open: num(tot?.open),
      feesMonth: num(fees?.fee),
      byMethod: metodos.map((m) => ({ name: m.name ?? 'Avulso', open: num(m.open), overdue: num(m.overdue), nextDate: day(m.next) })),
    };
  }

  private storeSql(ctx: RequestContext) {
    return ctx.storeIds.length ? Prisma.sql`AND (r.store_id IS NULL OR r.store_id IN (${Prisma.join(ctx.storeIds)}))` : Prisma.empty;
  }

  async list(ctx: RequestContext, q: ReceivableQuery): Promise<Receivable[]> {
    await this.sync(ctx.tenantId);
    const hoje = asDate(todayBR());
    const where: Prisma.ReceivableWhereInput = { tenantId: ctx.tenantId };
    if (ctx.storeIds.length) where.OR = [{ storeId: null }, { storeId: { in: ctx.storeIds } }];
    if (q.status === 'vencido') Object.assign(where, { status: 'aberto', dueDate: { lt: hoje } });
    else if (q.status !== 'todos') where.status = q.status;
    const campoData = q.status === 'recebido' ? 'receivedDate' : 'dueDate';
    if (q.from || q.to) (where as Record<string, unknown>)[campoData] = { ...(q.from ? { gte: asDate(q.from) } : {}), ...(q.to ? { lte: asDate(q.to) } : {}), ...(q.status === 'vencido' ? { lt: hoje } : {}) };
    if (q.methodId) where.methodId = q.methodId;
    if (q.search?.trim()) where.description = { contains: q.search.trim(), mode: 'insensitive' };
    const rows = await this.prisma.receivable.findMany({ where, orderBy: [{ dueDate: q.status === 'recebido' ? 'desc' : 'asc' }, { createdAt: 'asc' }], take: 1000 });
    const metodos = new Map((await this.prisma.paymentMethod.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
    const vendas = new Map((await this.prisma.sale.findMany({ where: { id: { in: rows.map((r) => r.saleId).filter((x): x is string => !!x) } }, select: { id: true, channel: true } })).map((s) => [s.id, s.channel]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as Receivable['kind'],
      description: r.description,
      methodName: r.methodId ? (metodos.get(r.methodId) ?? null) : null,
      channel: r.saleId ? ((SALE_CHANNELS as Record<string, string>)[vendas.get(r.saleId) ?? ''] ?? null) : null,
      gross: num(r.gross),
      fee: num(r.fee),
      net: num(r.net),
      saleDate: day(r.saleDate)!,
      dueDate: day(r.dueDate)!,
      status: r.status as Receivable['status'],
      receivedDate: day(r.receivedDate),
      receivedAmount: r.receivedAmount == null ? null : num(r.receivedAmount),
      note: r.note,
    }));
  }

  /** Conferiu o extrato: dá baixa (um valor diferente só vale com um item). */
  async settle(ctx: RequestContext, d: ReceivableSettleInput) {
    const rows = await this.prisma.receivable.findMany({ where: { tenantId: ctx.tenantId, id: { in: d.ids } } });
    if (rows.length !== new Set(d.ids).size) throw new NotFoundError('RECEIVABLE_NOT_FOUND', 'Algum recebível não foi encontrado.');
    if (rows.some((r) => r.status !== 'aberto')) throw new ConflictError('RECEIVABLE_NOT_OPEN', 'Algum item já foi recebido ou cancelado.');
    if (d.amount !== undefined && rows.length > 1) throw new ConflictError('AMOUNT_SINGLE', 'Valor diferente só dá para informar recebendo um item por vez.');
    await this.prisma.$transaction(
      rows.map((r) =>
        this.prisma.receivable.update({ where: { id: r.id }, data: { status: 'recebido', receivedDate: asDate(d.receivedDate), receivedAmount: d.amount ?? r.net, ...(d.note ? { note: d.note } : {}) } }),
      ),
    );
    await this.audit.record(ctx, 'receivable.settle', 'receivable', rows.length === 1 ? rows[0]!.id : null, { quantidade: rows.length, data: d.receivedDate, valor: d.amount ?? null });
    return { ok: true, received: rows.length };
  }

  async reopen(ctx: RequestContext, id: string) {
    const r = await this.prisma.receivable.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!r) throw new NotFoundError('RECEIVABLE_NOT_FOUND', 'Recebível não encontrado.');
    if (r.status !== 'recebido') throw new ConflictError('RECEIVABLE_NOT_RECEIVED', 'Só dá para desfazer o que foi recebido.');
    const metodo = r.methodId ? await this.prisma.paymentMethod.findUnique({ where: { id: r.methodId }, select: { reconcile: true, settleDays: true } }) : null;
    if (metodo && (!metodo.reconcile || metodo.settleDays === 0) && r.dueDate <= asDate(todayBR())) throw new ConflictError('AUTO_SETTLED', 'Esta forma de pagamento dá baixa sozinha. Para conferir pelo extrato, ligue "Conferir extrato" em Taxas e prazos.');
    await this.prisma.receivable.update({ where: { id }, data: { status: 'aberto', receivedDate: null, receivedAmount: null } });
    await this.audit.record(ctx, 'receivable.reopen', 'receivable', id, {});
    return { ok: true };
  }

  async createManual(ctx: RequestContext, d: ReceivableManualInput) {
    const r = await this.prisma.receivable.create({
      data: { tenantId: ctx.tenantId, kind: 'avulso', description: d.description, gross: d.amount, net: d.amount, saleDate: asDate(todayBR()), dueDate: asDate(d.dueDate), note: d.note ?? null },
    });
    await this.audit.record(ctx, 'receivable.create', 'receivable', r.id, { valor: d.amount });
    return { id: r.id };
  }

  async cancelManual(ctx: RequestContext, id: string) {
    const r = await this.prisma.receivable.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!r) throw new NotFoundError('RECEIVABLE_NOT_FOUND', 'Recebível não encontrado.');
    if (r.kind !== 'avulso') throw new ConflictError('RECEIVABLE_FROM_SALE', 'Recebível de venda some sozinho quando a venda é cancelada.');
    if (r.status !== 'aberto') throw new ConflictError('RECEIVABLE_NOT_OPEN', 'Só dá para cancelar o que está a receber.');
    await this.prisma.receivable.update({ where: { id }, data: { status: 'cancelado' } });
    return { ok: true };
  }

  // ───────────── Taxas e prazos ─────────────

  async fees(ctx: RequestContext): Promise<PaymentMethodFees[]> {
    const ms = await this.prisma.paymentMethod.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return ms.map((m) => ({ id: m.id, name: m.name, kind: m.kind, active: m.active, feePct: num(m.feePct), feeFixed: num(m.feeFixed), settleDays: m.settleDays, reconcile: m.reconcile }));
  }

  /** Salva as taxas e recalcula o que ainda está a receber (o que já caiu não muda). */
  async saveFees(ctx: RequestContext, d: PaymentFeesInput) {
    const ids = d.methods.map((m) => m.id);
    const existentes = await this.prisma.paymentMethod.count({ where: { tenantId: ctx.tenantId, id: { in: ids } } });
    if (existentes !== ids.length) throw new NotFoundError('METHOD_NOT_FOUND', 'Forma de pagamento não encontrada.');
    await this.prisma.$transaction(async (tx) => {
      for (const m of d.methods) {
        await tx.paymentMethod.update({ where: { id: m.id }, data: { feePct: m.feePct, feeFixed: m.feeFixed, settleDays: m.settleDays, reconcile: m.reconcile } });
        await tx.$executeRaw`
          UPDATE receivable SET fee = f.fee, net = gross - f.fee, due_date = sale_date + ${m.settleDays}::int
            FROM (SELECT id AS rid, CASE WHEN gross > 0 THEN ROUND(gross * ${m.feePct}::numeric / 100 + ${m.feeFixed}::numeric, 2) ELSE 0 END AS fee FROM receivable WHERE method_id = ${m.id} AND status = 'aberto') f
           WHERE id = f.rid`;
      }
    });
    await this.audit.record(ctx, 'payment_method.fees', 'payment_method', null, { formas: d.methods.length });
    await this.sync(ctx.tenantId);
    return this.fees(ctx);
  }

  // ───────────── Configuração do DRE ─────────────

  async config(tenantId: string): Promise<FinanceConfig> {
    const s = await this.prisma.tenantSetting.findUnique({ where: { tenantId }, select: { financeConfig: true } });
    return financeConfigSchema.parse(s?.financeConfig ?? {});
  }

  async saveConfig(ctx: RequestContext, d: FinanceConfig) {
    await this.prisma.tenantSetting.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, financeConfig: d }, update: { financeConfig: d } });
    await this.audit.record(ctx, 'finance.config', 'tenant_setting', null, d);
    return d;
  }

}
