import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CATEGORY_TO_CHART,
  DEFAULT_CHART,
  todayBR,
  type AccountEntry,
  type AccountMoveInput,
  type ChartAccount,
  type ChartAccountInput,
  type FinancialAccount,
  type FinancialAccountInput,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
type Tx = Prisma.TransactionClient;

/**
 * Plano de contas e contas financeiras (caixa, banco, carteira) com extrato.
 * O plano padrão e as duas contas iniciais nascem na primeira consulta; depois a loja edita.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Garante o plano padrão, as contas iniciais e liga o que ainda está sem conta. Pode rodar sempre (é barato). */
  async ensure(tenantId: string) {
    if (!(await this.prisma.chartAccount.count({ where: { tenantId } }))) {
      await this.prisma.chartAccount.createMany({ data: DEFAULT_CHART.map((c) => ({ tenantId, code: c.code, name: c.name, dreLine: c.dreLine, cashOnly: c.cashOnly ?? false })), skipDuplicates: true });
    }
    if (!(await this.prisma.financialAccount.count({ where: { tenantId } }))) {
      const hoje = asDate(todayBR());
      await this.prisma.financialAccount.createMany({
        data: [
          { tenantId, name: 'Caixa da loja (dinheiro)', kind: 'caixa', openingDate: hoje },
          { tenantId, name: 'Conta bancária', kind: 'banco', openingDate: hoje },
        ],
        skipDuplicates: true,
      });
    }
    // Formas de pagamento sem conta: dinheiro cai no caixa, o resto na conta bancária.
    await this.prisma.$executeRaw`
      UPDATE payment_method pm SET account_id = (
        SELECT a.id FROM financial_account a WHERE a.tenant_id = pm.tenant_id AND a.active AND a.kind = CASE WHEN pm.kind = 'dinheiro' THEN 'caixa' ELSE 'banco' END ORDER BY a.created_at LIMIT 1)
       WHERE pm.tenant_id = ${tenantId} AND pm.account_id IS NULL`;
    // Contas a pagar antigas (por categoria) ganham a conta do plano.
    const casos = Prisma.join(Object.entries(CATEGORY_TO_CHART).map(([cat, code]) => Prisma.sql`WHEN ${cat} THEN ${code}`), ' ');
    await this.prisma.$executeRaw`
      UPDATE payable p SET chart_account_id = c.id
        FROM chart_account c
       WHERE p.tenant_id = ${tenantId} AND p.chart_account_id IS NULL AND c.tenant_id = p.tenant_id
         AND c.code = CASE WHEN p.category = 'folha' AND p.description LIKE 'Comissão __/____ · %' THEN '4.2' ELSE (CASE p.category ${casos} ELSE '5.3.9' END) END`;
    await this.prisma.$executeRaw`UPDATE payable SET competence = due_date WHERE tenant_id = ${tenantId} AND competence IS NULL`;
  }

  // ───────────── Plano de contas ─────────────

  async chart(ctx: RequestContext): Promise<ChartAccount[]> {
    await this.ensure(ctx.tenantId);
    const [rows, usos] = await Promise.all([
      this.prisma.chartAccount.findMany({ where: { tenantId: ctx.tenantId } }),
      this.prisma.$queryRaw<Array<{ id: string; n: bigint }>>`
        SELECT id, SUM(n) AS n FROM (
          SELECT chart_account_id AS id, COUNT(*) AS n FROM payable WHERE tenant_id = ${ctx.tenantId} AND chart_account_id IS NOT NULL AND status <> 'canceled' GROUP BY 1
          UNION ALL SELECT chart_account_id, COUNT(*) FROM receivable WHERE tenant_id = ${ctx.tenantId} AND chart_account_id IS NOT NULL AND status <> 'cancelado' GROUP BY 1) x GROUP BY 1`,
    ]);
    const uso = new Map(usos.map((u) => [u.id, Number(u.n)]));
    const codes = rows.map((r) => r.code);
    return rows
      .sort((a, b) => cmpCode(a.code, b.code))
      .map((r) => ({ id: r.id, code: r.code, name: r.name, dreLine: r.dreLine as ChartAccount['dreLine'], cashOnly: r.cashOnly, active: r.active, group: codes.some((c) => c.startsWith(`${r.code}.`)), entries: uso.get(r.id) ?? 0 }));
  }

  async saveChartAccount(ctx: RequestContext, id: string | null, d: ChartAccountInput) {
    const mesmoCodigo = await this.prisma.chartAccount.findFirst({ where: { tenantId: ctx.tenantId, code: d.code, ...(id ? { NOT: { id } } : {}) } });
    if (mesmoCodigo) throw new ConflictError('CHART_CODE', `Já existe a conta ${d.code} (${mesmoCodigo.name}).`);
    const partes = d.code.split('.');
    if (partes.length > 1) {
      const pai = await this.prisma.chartAccount.findFirst({ where: { tenantId: ctx.tenantId, code: partes.slice(0, -1).join('.') } });
      if (!pai) throw new DomainError('CHART_PARENT', `Crie antes o grupo ${partes.slice(0, -1).join('.')}.`);
      // A conta que vira grupo não pode ter lançamentos: eles ficariam fora do DRE.
      if (!id && (await this.usada(ctx.tenantId, pai.id))) throw new ConflictError('CHART_PARENT_USED', `A conta ${pai.code} (${pai.name}) já tem lançamentos. Crie a nova conta em outro grupo ou mova os lançamentos antes.`);
    }
    if (id) {
      const atual = await this.prisma.chartAccount.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!atual) throw new NotFoundError('conta do plano', id);
      if (atual.code !== d.code && (await this.prisma.chartAccount.count({ where: { tenantId: ctx.tenantId, code: { startsWith: `${atual.code}.` } } }))) throw new ConflictError('CHART_HAS_CHILDREN', 'Esta conta tem contas abaixo dela: o código não pode mudar.');
      await this.prisma.chartAccount.update({ where: { id }, data: d });
    } else {
      id = (await this.prisma.chartAccount.create({ data: { tenantId: ctx.tenantId, ...d } })).id;
    }
    await this.audit.record(ctx, 'chart.save', 'chart_account', id, { code: d.code, name: d.name });
    return { id };
  }

  private async usada(tenantId: string, id: string) {
    const [p, r] = await Promise.all([this.prisma.payable.count({ where: { tenantId, chartAccountId: id } }), this.prisma.receivable.count({ where: { tenantId, chartAccountId: id } })]);
    return p + r > 0;
  }

  async deleteChartAccount(ctx: RequestContext, id: string) {
    const c = await this.prisma.chartAccount.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw new NotFoundError('conta do plano', id);
    if (await this.prisma.chartAccount.count({ where: { tenantId: ctx.tenantId, code: { startsWith: `${c.code}.` } } })) throw new ConflictError('CHART_HAS_CHILDREN', 'Apague antes as contas que estão dentro deste grupo.');
    if (await this.usada(ctx.tenantId, id)) throw new ConflictError('CHART_USED', 'Esta conta já tem lançamentos. Desative em vez de apagar.');
    await this.prisma.chartAccount.delete({ where: { id } });
    await this.audit.record(ctx, 'chart.delete', 'chart_account', id, { code: c.code });
    return { ok: true };
  }

  /** Conta do plano que pode receber lançamento (ativa e sem contas abaixo). */
  async postable(tenantId: string, id: string) {
    const c = await this.prisma.chartAccount.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundError('conta do plano', id);
    if (await this.prisma.chartAccount.count({ where: { tenantId, code: { startsWith: `${c.code}.` } } })) throw new DomainError('CHART_GROUP', `"${c.name}" é um grupo. Escolha uma conta dentro dele.`);
    return c;
  }

  async byCode(tenantId: string, code: string) {
    await this.ensure(tenantId);
    return this.prisma.chartAccount.findFirst({ where: { tenantId, code } });
  }

  // ───────────── Contas financeiras ─────────────

  async accounts(ctx: RequestContext): Promise<FinancialAccount[]> {
    await this.ensure(ctx.tenantId);
    const rows = await this.prisma.$queryRaw<Array<Prisma.FinancialAccountGetPayload<object> & { opening_balance: Prisma.Decimal; opening_date: Date; pix_key: string | null; mov: Prisma.Decimal | null }>>`
      SELECT a.*, (SELECT SUM(e.amount) FROM account_entry e WHERE e.account_id = a.id AND e.date >= a.opening_date) AS mov
        FROM financial_account a WHERE a.tenant_id = ${ctx.tenantId} ORDER BY a.active DESC, a.kind, a.name`;
    return rows.map((a) => ({ id: a.id, name: a.name, kind: a.kind as FinancialAccount['kind'], bank: a.bank, agency: a.agency, number: a.number, pixKey: a.pix_key, openingBalance: num(a.opening_balance), openingDate: day(a.opening_date), active: a.active, balance: Math.round((num(a.opening_balance) + num(a.mov)) * 100) / 100 }));
  }

  async saveAccount(ctx: RequestContext, id: string | null, d: FinancialAccountInput) {
    const repetida = await this.prisma.financialAccount.findFirst({ where: { tenantId: ctx.tenantId, name: d.name, ...(id ? { NOT: { id } } : {}) } });
    if (repetida) throw new ConflictError('ACCOUNT_NAME', 'Já existe uma conta com esse nome.');
    const data = { name: d.name, kind: d.kind, bank: d.bank ?? null, agency: d.agency ?? null, number: d.number ?? null, pixKey: d.pixKey ?? null, openingBalance: d.openingBalance, active: d.active, ...(d.openingDate ? { openingDate: asDate(d.openingDate) } : {}) };
    if (id) {
      const r = await this.prisma.financialAccount.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
      if (!r.count) throw new NotFoundError('conta', id);
    } else id = (await this.prisma.financialAccount.create({ data: { tenantId: ctx.tenantId, ...data, openingDate: asDate(d.openingDate ?? todayBR()) } })).id;
    await this.audit.record(ctx, 'account.save', 'financial_account', id, { name: d.name, saldoInicial: d.openingBalance });
    return { id };
  }

  async account(tenantId: string, id: string) {
    const a = await this.prisma.financialAccount.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundError('conta', id);
    return a;
  }

  /** Extrato da conta no período, com saldo linha a linha. */
  async statement(ctx: RequestContext, id: string, from: string, to: string): Promise<{ opening: number; closing: number; entries: AccountEntry[] }> {
    const a = await this.account(ctx.tenantId, id);
    const inicio = from < day(a.openingDate) ? day(a.openingDate) : from;
    const [antes] = await this.prisma.$queryRaw<Array<{ v: Prisma.Decimal | null }>>`SELECT SUM(amount) AS v FROM account_entry WHERE account_id = ${id} AND date >= ${a.openingDate} AND date < ${asDate(inicio)}`;
    const rows = await this.prisma.accountEntry.findMany({ where: { accountId: id, date: { gte: asDate(inicio), lte: asDate(to) } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], take: 5000 });
    let saldo = Math.round((num(a.openingBalance) + num(antes?.v)) * 100) / 100;
    const opening = saldo;
    const entries = rows.map((e) => {
      saldo = Math.round((saldo + num(e.amount)) * 100) / 100;
      return { id: e.id, date: day(e.date), amount: num(e.amount), kind: e.kind as AccountEntry['kind'], description: e.description, balance: saldo, manual: !e.payableId && !e.receivableId };
    });
    return { opening, closing: saldo, entries };
  }

  /** Transferência entre contas ou ajuste de saldo. */
  async move(ctx: RequestContext, d: AccountMoveInput) {
    const origem = await this.account(ctx.tenantId, d.accountId);
    if (d.kind === 'transferencia') {
      if (!d.toAccountId || d.toAccountId === d.accountId) throw new DomainError('TRANSFER_TARGET', 'Escolha a conta de destino.');
      if (d.amount <= 0) throw new DomainError('TRANSFER_AMOUNT', 'O valor da transferência é positivo.');
      const destino = await this.account(ctx.tenantId, d.toAccountId);
      const transferId = randomUUID();
      const base = { tenantId: ctx.tenantId, date: asDate(d.date), kind: 'transferencia', transferId, userId: ctx.userId };
      await this.prisma.accountEntry.createMany({
        data: [
          { ...base, accountId: origem.id, amount: -d.amount, description: d.description || `Transferência para ${destino.name}` },
          { ...base, accountId: destino.id, amount: d.amount, description: d.description || `Transferência de ${origem.name}` },
        ],
      });
    } else {
      await this.prisma.accountEntry.create({ data: { tenantId: ctx.tenantId, accountId: origem.id, date: asDate(d.date), amount: d.amount, kind: 'ajuste', description: d.description || 'Ajuste de saldo', userId: ctx.userId } });
    }
    await this.audit.record(ctx, `account.${d.kind}`, 'financial_account', origem.id, { valor: d.amount, data: d.date });
    return { ok: true };
  }

  async deleteEntry(ctx: RequestContext, id: string) {
    const e = await this.prisma.accountEntry.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!e) throw new NotFoundError('lançamento', id);
    if (e.payableId || e.receivableId) throw new ConflictError('ENTRY_LINKED', 'Este lançamento veio de uma conta paga ou recebida. Desfaça o pagamento ou o recebimento.');
    await this.prisma.accountEntry.deleteMany({ where: { tenantId: ctx.tenantId, ...(e.transferId ? { transferId: e.transferId } : { id }) } });
    await this.audit.record(ctx, 'account.entry_delete', 'account_entry', id, { valor: num(e.amount) });
    return { ok: true };
  }

  /** Lança (ou refaz) no extrato o pagamento de uma conta a pagar. */
  async postPayable(tx: Tx, p: { id: string; tenantId: string; amount: Prisma.Decimal | number; description: string }, accountId: string | null, date: Date, userId: string) {
    await tx.accountEntry.deleteMany({ where: { payableId: p.id } });
    if (accountId) await tx.accountEntry.create({ data: { tenantId: p.tenantId, accountId, date, amount: -num(p.amount), kind: 'pagamento', description: p.description, payableId: p.id, userId } });
  }

  /** Recebíveis recebidos entram no extrato da conta da forma de pagamento; o que deixou de estar recebido sai. */
  async syncReceivables(tenantId: string) {
    await this.prisma.$executeRaw`
      DELETE FROM account_entry e USING receivable r
       WHERE e.receivable_id = r.id AND e.tenant_id = ${tenantId} AND (r.status <> 'recebido' OR r.received_amount IS DISTINCT FROM e.amount OR r.received_date IS DISTINCT FROM e.date)`;
    await this.prisma.$executeRaw`
      INSERT INTO account_entry (id, tenant_id, account_id, date, amount, kind, description, receivable_id)
      SELECT gen_random_uuid()::text, r.tenant_id, COALESCE(r.account_id, pm.account_id), r.received_date, r.received_amount, 'recebimento',
             r.description || COALESCE(' · ' || pm.name, ''), r.id
        FROM receivable r LEFT JOIN payment_method pm ON pm.id = r.method_id
       WHERE r.tenant_id = ${tenantId} AND r.status = 'recebido' AND r.received_amount <> 0 AND COALESCE(r.account_id, pm.account_id) IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM account_entry e WHERE e.receivable_id = r.id)
      ON CONFLICT (receivable_id) DO NOTHING`;
  }

  /** Saldo somado das contas ativas no fim de um dia. */
  async balanceAt(tenantId: string, date: string) {
    const [r] = await this.prisma.$queryRaw<Array<{ v: Prisma.Decimal | null; n: bigint }>>`
      SELECT COUNT(*) AS n, SUM(CASE WHEN a.opening_date <= ${asDate(date)} THEN a.opening_balance ELSE 0 END + COALESCE((SELECT SUM(e.amount) FROM account_entry e WHERE e.account_id = a.id AND e.date >= a.opening_date AND e.date <= ${asDate(date)}), 0)) AS v
        FROM financial_account a WHERE a.tenant_id = ${tenantId} AND a.active`;
    return { accounts: Number(r?.n ?? 0), balance: Math.round(num(r?.v) * 100) / 100 };
  }

  async names(tenantId: string) {
    const [chart, accounts] = await Promise.all([this.prisma.chartAccount.findMany({ where: { tenantId }, select: { id: true, code: true, name: true } }), this.prisma.financialAccount.findMany({ where: { tenantId }, select: { id: true, name: true } })]);
    return { chart: new Map(chart.map((c) => [c.id, `${c.code} ${c.name}`])), accounts: new Map(accounts.map((a) => [a.id, a.name])) };
  }
}

/** Ordena códigos como 5.2 antes de 5.10. */
export function cmpCode(a: string, b: string) {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
  }
  return 0;
}
