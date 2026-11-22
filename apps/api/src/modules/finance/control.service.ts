import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, todayBR, type BankLine, type BankLineAction, type BudgetReport, type BudgetRow, type BudgetSaveInput, type Reconciliation, type SellerCommissionRow } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';
import { DreService } from './dre.service';
import { FinanceService } from './finance.service';
import { LedgerService } from './ledger.service';
import { parseOfx } from './ofx';
import { ReceivablesService } from './receivables.service';

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const fimDoMes = (m: string) => day(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)));

/** Conciliação bancária (OFX), orçamento e comissão de vendedor. */
@Injectable()
export class ControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly finance: FinanceService,
    private readonly receivables: ReceivablesService,
    private readonly dre: DreService,
  ) {}

  // ───────────── Conciliação bancária ─────────────

  /** Guarda as linhas do extrato do banco (sem repetir as que já vieram) e casa sozinho o que é óbvio. */
  async importOfx(ctx: RequestContext, accountId: string, content: string) {
    await this.ledger.account(ctx.tenantId, accountId);
    const linhas = parseOfx(content);
    if (!linhas.length) throw new DomainError('OFX_EMPTY', 'Não achei movimentações nesse arquivo. Exporte o extrato do banco no formato OFX.');
    const r = await this.prisma.bankLine.createMany({ data: linhas.map((l) => ({ tenantId: ctx.tenantId, accountId, date: asDate(l.date), amount: l.amount, memo: l.memo, fitid: l.fitid })), skipDuplicates: true });
    const matched = await this.autoMatch(ctx.tenantId, accountId);
    await this.audit.record(ctx, 'bank.import', 'financial_account', accountId, { linhas: linhas.length, novas: r.count, conciliadas: matched });
    return { read: linhas.length, added: r.count, matched };
  }

  /** Casa cada linha pendente com o lançamento do sistema de mesmo valor e data mais próxima (até 3 dias). */
  private async autoMatch(tenantId: string, accountId: string) {
    await this.prisma.$executeRaw`UPDATE bank_line SET status = 'pendente' WHERE tenant_id = ${tenantId} AND account_id = ${accountId} AND status = 'conciliado' AND entry_id IS NULL`;
    const pend = await this.prisma.bankLine.findMany({ where: { tenantId, accountId, status: 'pendente' }, orderBy: { date: 'asc' } });
    if (!pend.length) return 0;
    const de = addDays(day(pend[0]!.date), -3);
    const ate = addDays(day(pend[pend.length - 1]!.date), 3);
    const livres = await this.prisma.$queryRaw<Array<{ id: string; date: Date; amount: Prisma.Decimal }>>`
      SELECT e.id, e.date, e.amount FROM account_entry e
       WHERE e.tenant_id = ${tenantId} AND e.account_id = ${accountId} AND e.date BETWEEN ${asDate(de)} AND ${asDate(ate)}
         AND NOT EXISTS (SELECT 1 FROM bank_line b WHERE b.entry_id = e.id)`;
    const usados = new Set<string>();
    let n = 0;
    for (const l of pend) {
      const alvo = livres
        .filter((e) => !usados.has(e.id) && Math.abs(num(e.amount) - num(l.amount)) < 0.005 && Math.abs(e.date.getTime() - l.date.getTime()) <= 3 * 86_400_000)
        .sort((a, b) => Math.abs(a.date.getTime() - l.date.getTime()) - Math.abs(b.date.getTime() - l.date.getTime()))[0];
      if (!alvo) continue;
      usados.add(alvo.id);
      await this.prisma.bankLine.update({ where: { id: l.id }, data: { status: 'conciliado', entryId: alvo.id } });
      n++;
    }
    return n;
  }

  async reconciliation(ctx: RequestContext, accountId: string, from: string, to: string): Promise<Reconciliation> {
    await this.ledger.account(ctx.tenantId, accountId);
    await this.ledger.syncReceivables(ctx.tenantId);
    await this.autoMatch(ctx.tenantId, accountId);
    const linhas = await this.prisma.bankLine.findMany({ where: { tenantId: ctx.tenantId, accountId, date: { gte: asDate(from), lte: asDate(to) } }, orderBy: [{ date: 'desc' }, { createdAt: 'asc' }], take: 3000 });
    const ligados = await this.prisma.accountEntry.findMany({ where: { id: { in: linhas.map((l) => l.entryId).filter((x): x is string => !!x) } } });
    const livres = await this.prisma.$queryRaw<Array<{ id: string; date: Date; amount: Prisma.Decimal; description: string }>>`
      SELECT e.id, e.date, e.amount, e.description FROM account_entry e
       WHERE e.tenant_id = ${ctx.tenantId} AND e.account_id = ${accountId} AND e.date BETWEEN ${asDate(addDays(from, -10))} AND ${asDate(addDays(to, 10))}
         AND NOT EXISTS (SELECT 1 FROM bank_line b WHERE b.entry_id = e.id) ORDER BY e.date`;
    const abertas = await this.prisma.payable.findMany({ where: { tenantId: ctx.tenantId, status: 'open' }, select: { id: true, amount: true, dueDate: true, description: true }, orderBy: { dueDate: 'asc' }, take: 2000 });
    const out: BankLine[] = linhas.map((l) => {
      const e = ligados.find((x) => x.id === l.entryId);
      const pendente = l.status === 'pendente';
      const v = num(l.amount);
      return {
        id: l.id,
        date: day(l.date),
        amount: v,
        memo: l.memo,
        status: l.status as BankLine['status'],
        entry: e ? { id: e.id, date: day(e.date), description: e.description } : null,
        entryOptions: pendente ? livres.filter((x) => Math.abs(num(x.amount) - v) < 0.005).slice(0, 5).map((x) => ({ id: x.id, date: day(x.date), description: x.description })) : [],
        payableOptions: pendente && v < 0 ? abertas.filter((p) => Math.abs(num(p.amount) + v) < 0.005).slice(0, 5).map((p) => ({ id: p.id, dueDate: day(p.dueDate), description: p.description })) : [],
      };
    });
    const temExtrato = linhas.length > 0;
    return {
      lines: out,
      pending: out.filter((l) => l.status === 'pendente').length,
      matched: out.filter((l) => l.status === 'conciliado').length,
      ignored: out.filter((l) => l.status === 'ignorado').length,
      missingInBank: temExtrato ? livres.filter((e) => day(e.date) >= from && day(e.date) <= to).map((e) => ({ id: e.id, date: day(e.date), amount: num(e.amount), description: e.description })) : [],
    };
  }

  async bankLineAction(ctx: RequestContext, id: string, a: BankLineAction) {
    const l = await this.prisma.bankLine.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!l) throw new NotFoundError('linha do extrato', id);
    const v = num(l.amount);
    const data = day(l.date);
    const ligar = (entryId: string) => this.prisma.bankLine.update({ where: { id }, data: { status: 'conciliado', entryId } });
    if (a.action === 'undo') {
      await this.prisma.bankLine.update({ where: { id }, data: { status: 'pendente', entryId: null } });
    } else if (l.status === 'conciliado' && l.entryId) {
      throw new ConflictError('LINE_MATCHED', 'Esta linha já está conciliada. Desfaça antes de mudar.');
    } else if (a.action === 'ignore') {
      await this.prisma.bankLine.update({ where: { id }, data: { status: 'ignorado', entryId: null } });
    } else if (a.action === 'match') {
      const e = await this.prisma.accountEntry.findFirst({ where: { id: a.entryId, tenantId: ctx.tenantId, accountId: l.accountId } });
      if (!e) throw new NotFoundError('lançamento', a.entryId);
      if (Math.abs(num(e.amount) - v) > 0.005) throw new DomainError('AMOUNT_DIFFERENT', 'O valor do lançamento é diferente do valor no banco.');
      if (await this.prisma.bankLine.count({ where: { entryId: e.id } })) throw new ConflictError('ENTRY_MATCHED', 'Esse lançamento já foi conciliado com outra linha.');
      await ligar(e.id);
    } else if (a.action === 'pay') {
      if (v >= 0) throw new DomainError('NOT_A_PAYMENT', 'Só uma saída do banco paga uma conta.');
      await this.finance.payPayable(ctx, a.payableId, data, 'Baixa pela conciliação bancária', l.accountId);
      const e = await this.prisma.accountEntry.findFirstOrThrow({ where: { payableId: a.payableId } });
      await ligar(e.id);
    } else {
      const descricao = a.description || l.memo || (v < 0 ? 'Saída no banco' : 'Entrada no banco');
      if (a.chartAccountId && v < 0) {
        const [p] = await this.finance.createPayable(ctx, { description: descricao, category: 'outros', chartAccountId: a.chartAccountId, amount: -v, dueDate: data, competence: data, repeat: 1 });
        await this.finance.payPayable(ctx, p!.id, data, 'Lançada pela conciliação bancária', l.accountId);
        await ligar((await this.prisma.accountEntry.findFirstOrThrow({ where: { payableId: p!.id } })).id);
      } else if (a.chartAccountId) {
        const r = await this.receivables.createManual(ctx, { description: descricao, amount: v, dueDate: data, chartAccountId: a.chartAccountId });
        await this.receivables.settle(ctx, { ids: [r.id], receivedDate: data, accountId: l.accountId });
        await ligar((await this.prisma.accountEntry.findFirstOrThrow({ where: { receivableId: r.id } })).id);
      } else {
        const e = await this.prisma.accountEntry.create({ data: { tenantId: ctx.tenantId, accountId: l.accountId, date: l.date, amount: v, kind: 'ajuste', description: descricao, userId: ctx.userId } });
        await ligar(e.id);
      }
    }
    await this.audit.record(ctx, `bank.${a.action}`, 'bank_line', id, { valor: v, data });
    return { ok: true };
  }

  // ───────────── Orçamento ─────────────

  /** Orçado × realizado do mês, linha a linha do DRE por competência. */
  async budget(ctx: RequestContext, month: string): Promise<BudgetReport> {
    const from = `${month}-01`;
    const [dre, orcado] = await Promise.all([
      this.dre.dre(ctx, { from, to: fimDoMes(month), view: 'competencia' }),
      this.prisma.budget.findMany({ where: { tenantId: ctx.tenantId, month: asDate(from) } }),
    ]);
    const valor = new Map(orcado.map((b) => [b.lineKey, num(b.amount)]));
    const rows: BudgetRow[] = [];
    // Orça-se a conta que recebe lançamento: linha de nível 2 calculada ou com conta, e as contas dentro de um subgrupo.
    let grupo = '';
    let sub = '';
    for (const l of dre.lines) {
      if (l.level === 1) grupo = l.label;
      const subgrupo = l.level === 2 && !l.accountId && !l.auto;
      if (l.level === 2) sub = subgrupo ? l.label : '';
      if (subgrupo || l.level < 2 || (l.level === 3 && !l.accountId)) continue;
      rows.push({ key: l.key, label: l.label, code: l.code ?? null, group: l.level === 3 && sub ? `${grupo} › ${sub}` : grupo, sign: l.sign, budget: valor.get(l.key) ?? 0, actual: r2(l.values.total ?? 0) });
    }
    return { month, rows, resultBudget: r2(rows.reduce((s, r) => s + r.sign * r.budget, 0)), resultActual: r2(rows.reduce((s, r) => s + r.sign * r.actual, 0)) };
  }

  async saveBudget(ctx: RequestContext, d: BudgetSaveInput) {
    const meses = [d.month];
    if (d.copyToYearEnd) for (let m = Number(d.month.slice(5, 7)) + 1; m <= 12; m++) meses.push(`${d.month.slice(0, 4)}-${String(m).padStart(2, '0')}`);
    await this.prisma.$transaction(async (tx) => {
      for (const m of meses) {
        const month = asDate(`${m}-01`);
        await tx.budget.deleteMany({ where: { tenantId: ctx.tenantId, month, lineKey: { in: d.items.map((i) => i.key) } } });
        const data = d.items.filter((i) => i.amount > 0).map((i) => ({ tenantId: ctx.tenantId, month, lineKey: i.key, amount: i.amount }));
        if (data.length) await tx.budget.createMany({ data });
      }
    });
    await this.audit.record(ctx, 'budget.save', 'budget', null, { mes: d.month, linhas: d.items.length, meses: meses.length });
    return { ok: true, months: meses.length };
  }

  // ───────────── Comissão de vendedor ─────────────

  /** Vendas de cada pessoa no período e a comissão pelo percentual do cadastro de funcionário. */
  async sellerCommission(ctx: RequestContext, from: string, to: string): Promise<SellerCommissionRow[]> {
    if (from > to || to > addDays(todayBR(), 1)) to = todayBR();
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string; name: string; employee_id: string | null; pct: Prisma.Decimal | null; n: bigint; total: Prisma.Decimal }>>`
      SELECT u.id AS user_id, COALESCE(e.name, u.name) AS name, e.id AS employee_id, e.commission_pct AS pct, COUNT(*) AS n, SUM(s.total + s.cashback_used - s.delivery_fee) AS total
        FROM sale s JOIN app_user u ON u.id = s.seller_id LEFT JOIN employee e ON e.user_id = u.id
       WHERE s.tenant_id = ${ctx.tenantId} AND s.status = 'completed' ${ctx.storeIds.length ? Prisma.sql`AND s.store_id IN (${Prisma.join(ctx.storeIds)})` : Prisma.empty}
         AND (s.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${asDate(from)} AND ${asDate(to)}
       GROUP BY u.id, u.name, e.id, e.name, e.commission_pct ORDER BY total DESC`;
    return rows.map((r) => ({ userId: r.user_id, name: r.name, employeeId: r.employee_id, sales: Number(r.n), total: r2(num(r.total)), pct: num(r.pct), commission: Math.round((Math.round(num(r.total) * 100) * num(r.pct)) / 100) / 100 }));
  }
}
