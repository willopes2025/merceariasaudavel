import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  normalizeText,
  onlyDigits,
  todayBR,
  type CashbackEntry,
  type CashbackEntryType,
  type ClubSettings,
  type Customer,
  type CustomerGoal,
  type CustomerInput,
  type CustomerListQuery,
  type CustomerOption,
  type AppAccessCode,
  type CustomerRow,
  MEMBER_CODE_RULE,
  type Page,
  type TimelineItem,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';
import { clubRules, moveCashback } from './cashback';
import { ensureMemberCode, temporaryPin } from './member-code';

const ACTION_LABELS: Record<string, string> = {
  'customer.create': 'Cadastro',
  'customer.update': 'Cadastro alterado',
  'customer.member': 'Entrou no clube',
  'customer.member_left': 'Saiu do clube',
  'customer.app_access': 'Recebeu código de acesso ao app',
  'customer.app_signup': 'Entrou no clube pelo app',
  'sale.create': 'Compra',
  'sale.cancel': 'Compra cancelada',
};
const FIELD_LABELS: Record<string, string> = {
  name: 'nome', document: 'CPF', birthDate: 'nascimento', phone: 'celular', email: 'e-mail', allowWhatsapp: 'aceita WhatsApp', goal: 'objetivo', notes: 'observações', active: 'situação',
};

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, query: CustomerListQuery): Promise<Page<CustomerRow>> {
    const where: Prisma.CustomerWhereInput = { tenantId: ctx.tenantId };
    if (query.status !== 'all') where.active = query.status === 'active';
    if (query.members !== 'all') where.isMember = query.members === 'members';
    const terms = this.searchTerms(query.q);
    if (terms.length) where.AND = terms.map((t) => ({ searchText: { contains: t } }));
    if (query.birthMonth) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM customer WHERE tenant_id = ${ctx.tenantId} AND EXTRACT(MONTH FROM birth_date) = ${query.birthMonth}`;
      where.id = { in: rows.map((r) => r.id) };
    }
    const [total, items] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: query.birthMonth ? [{ birthDate: 'asc' }, { name: 'asc' }] : terms.length ? [{ name: 'asc' }] : [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: items.map((c) => ({
        id: c.id,
        name: c.name,
        document: c.document,
        phone: c.phone,
        isMember: c.isMember,
        cashbackBalance: Number(c.cashbackBalance),
        goal: c.goal as CustomerGoal | null,
        active: c.active,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  /** Busca do caixa: celular (pelos 8 últimos números), CPF ou nome. */
  async search(ctx: RequestContext, q: string): Promise<CustomerOption[]> {
    const text = q.trim();
    if (text.length < 2) return [];
    const digits = onlyDigits(text);
    const or: Prisma.CustomerWhereInput[] = [];
    const code = text.toUpperCase().replace(/\s/g, '');
    if (MEMBER_CODE_RULE.test(code)) or.push({ memberCode: code });
    if (digits.length >= 8 && digits.length === text.replace(/[\s().\-/+]/g, '').length) {
      if (digits.length === 11) or.push({ document: digits });
      or.push({ phone: { endsWith: digits.slice(-8) } });
    } else {
      or.push({ AND: this.searchTerms(text).map((t) => ({ searchText: { contains: t } })) });
    }
    const rows = await this.prisma.customer.findMany({ where: { tenantId: ctx.tenantId, active: true, OR: or }, orderBy: [{ isMember: 'desc' }, { name: 'asc' }], take: 8 });
    return rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone, document: c.document, isMember: c.isMember, cashbackBalance: Number(c.cashbackBalance) }));
  }

  /** Já existe alguém com este CPF ou celular? A tela pergunta antes de cadastrar. */
  async lookup(ctx: RequestContext, document?: string, phone?: string, exceptId?: string) {
    const doc = onlyDigits(document);
    const tel = onlyDigits(phone);
    const or: Prisma.CustomerWhereInput[] = [];
    if (doc.length >= 11) or.push({ document: doc });
    if (tel.length >= 10) or.push({ phone: { endsWith: tel.slice(-8) } });
    if (!or.length) return [];
    const found = await this.prisma.customer.findMany({
      where: { tenantId: ctx.tenantId, OR: or, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, name: true, document: true, phone: true, active: true, isMember: true },
      take: 5,
    });
    return found.map((c) => ({ ...c, matchedBy: doc && c.document === doc ? 'document' : 'phone' }));
  }

  async get(ctx: RequestContext, id: string): Promise<Customer> {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw new NotFoundError('cliente', id);
    const stats = await this.prisma.$queryRaw<Array<{ count: bigint; spent: Prisma.Decimal | null; last: Date | null }>>`
      SELECT COUNT(*) AS count, SUM(total + cashback_used) AS spent, MAX(created_at) AS last
        FROM sale WHERE tenant_id = ${ctx.tenantId} AND customer_id = ${id} AND status = 'completed'`;
    const s = stats[0]!;
    const access = await this.prisma.customerAccess.findFirst({ where: { customerId: id, tenantId: ctx.tenantId }, select: { mustChange: true, lastLoginAt: true } });
    const purchases = Number(s.count);
    const spent = Number(s.spent ?? 0);
    return {
      id: c.id,
      name: c.name,
      document: c.document,
      birthDate: c.birthDate?.toISOString().slice(0, 10) ?? null,
      phone: c.phone,
      email: c.email,
      allowWhatsapp: c.allowWhatsapp,
      goal: c.goal as CustomerGoal | null,
      isMember: c.isMember,
      memberSince: c.memberSince?.toISOString() ?? null,
      memberSource: (c.memberSource as 'loja' | 'app' | null) ?? null,
      cashbackBalance: Number(c.cashbackBalance),
      memberCode: c.memberCode,
      appAccess: !access ? 'nenhum' : access.mustChange ? 'provisorio' : 'ativo',
      appLastLoginAt: access?.lastLoginAt?.toISOString() ?? null,
      notes: c.notes,
      active: c.active,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      stats: { purchases, spent: Math.round(spent * 100) / 100, lastPurchaseAt: s.last?.toISOString() ?? null, averageTicket: purchases ? Math.round((spent / purchases) * 100) / 100 : 0 },
    };
  }

  async create(ctx: RequestContext, input: CustomerInput): Promise<Customer> {
    await this.assertDocumentFree(ctx, input.document, null);
    const c = await this.prisma.customer.create({
      data: { ...this.data(input), tenantId: ctx.tenantId, ...(input.isMember ? { memberSince: new Date(), memberSource: 'loja' } : {}) },
    });
    if (input.isMember) await ensureMemberCode(this.prisma, ctx.tenantId, c.id);
    await this.audit.record(ctx, 'customer.create', 'customer', c.id, { name: c.name });
    if (input.isMember) await this.audit.record(ctx, 'customer.member', 'customer', c.id, { source: 'loja' });
    return this.get(ctx, c.id);
  }

  async update(ctx: RequestContext, id: string, input: CustomerInput): Promise<Customer> {
    const current = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new NotFoundError('cliente', id);
    await this.assertDocumentFree(ctx, input.document, id);
    const data = this.data(input);
    const changed = (Object.keys(data) as Array<keyof typeof data>).filter(
      (k) => k !== 'searchText' && k !== 'isMember' && String(comparable(data[k]) ?? '') !== String(comparable(current[k as keyof typeof current]) ?? ''),
    );
    const joined = input.isMember && !current.isMember;
    const left = !input.isMember && current.isMember;
    await this.prisma.customer.update({ where: { id }, data: { ...data, ...(joined ? { memberSince: new Date(), memberSource: 'loja' } : {}) } });
    if (input.isMember) await ensureMemberCode(this.prisma, ctx.tenantId, id);
    if (changed.length) await this.audit.record(ctx, 'customer.update', 'customer', id, { fields: changed });
    if (joined) await this.audit.record(ctx, 'customer.member', 'customer', id, { source: 'loja' });
    if (left) await this.audit.record(ctx, 'customer.member_left', 'customer', id, {});
    return this.get(ctx, id);
  }

  /**
   * Balcão libera o app: gera um código provisório de 6 números (mostrado uma
   * vez). No primeiro login o cliente troca pelo próprio PIN. Serve também
   * para quem esqueceu o PIN. Derruba os logins anteriores.
   */
  async appAccess(ctx: RequestContext, id: string): Promise<AppAccessCode> {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw new NotFoundError('cliente', id);
    if (!c.active) throw new ConflictError('CUSTOMER_INACTIVE', 'Cliente desativada: reative o cadastro antes.');
    if (!c.phone) throw new ConflictError('PHONE_REQUIRED', 'Cadastre o celular: é com ele que a cliente entra no app.');
    const code = temporaryPin();
    const pinHash = await argon2.hash(code);
    await this.prisma.$transaction(async (tx) => {
      if (!c.isMember) await tx.customer.update({ where: { id }, data: { isMember: true, memberSince: new Date(), memberSource: 'loja' } });
      await ensureMemberCode(tx, ctx.tenantId, id);
      await tx.customerAccess.upsert({
        where: { customerId: id },
        create: { customerId: id, tenantId: ctx.tenantId, pinHash, mustChange: true },
        update: { pinHash, mustChange: true, version: { increment: 1 }, failedCount: 0, lockedUntil: null },
      });
    });
    if (!c.isMember) await this.audit.record(ctx, 'customer.member', 'customer', id, { source: 'loja' });
    await this.audit.record(ctx, 'customer.app_access', 'customer', id, {});
    return { code, phone: c.phone };
  }

  async cashback(ctx: RequestContext, id: string): Promise<CashbackEntry[]> {
    await this.get(ctx, id);
    const rows = await this.prisma.cashbackEntry.findMany({ where: { tenantId: ctx.tenantId, customerId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
    const saleIds = [...new Set(rows.map((r) => r.saleId).filter((v): v is string => Boolean(v)))];
    const sales = saleIds.length ? await this.prisma.sale.findMany({ where: { id: { in: saleIds } }, select: { id: true, number: true } }) : [];
    return rows.map((r) => ({
      id: r.id,
      type: r.type as CashbackEntryType,
      amount: Number(r.amount),
      balanceAfter: Number(r.balanceAfter),
      saleNumber: r.saleId ? (sales.find((s) => s.id === r.saleId)?.number ?? null) : null,
      expiresAt: r.expiresAt?.toISOString().slice(0, 10) ?? null,
      note: r.type === 'vencido' ? null : r.note,
      at: r.createdAt.toISOString(),
    }));
  }

  async timeline(ctx: RequestContext, id: string): Promise<TimelineItem[]> {
    await this.get(ctx, id);
    const entries = await this.prisma.auditLog.findMany({ where: { tenantId: ctx.tenantId, entity: 'customer', entityId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
    const userIds = [...new Set(entries.map((e) => e.userId).filter((u): u is string => Boolean(u)))];
    const users = userIds.length ? await this.prisma.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    return entries.map((e) => {
      const data = (e.data ?? {}) as { fields?: string[]; detail?: string };
      const base = data.detail ? `${ACTION_LABELS[e.action] ?? e.action} — ${data.detail}` : (ACTION_LABELS[e.action] ?? e.action);
      return {
        at: e.createdAt.toISOString(),
        action: e.action,
        label: data.fields?.length ? `${base}: ${data.fields.map((f) => FIELD_LABELS[f] ?? f).join(', ')}` : base,
        userName: e.userId ? (users.find((u) => u.id === e.userId)?.name ?? null) : null,
      };
    });
  }

  // ------------------------------------------------------------ regras do clube

  async club(ctx: RequestContext): Promise<ClubSettings> {
    return clubRules(this.prisma, ctx.tenantId);
  }

  async saveClub(ctx: RequestContext, input: ClubSettings): Promise<ClubSettings> {
    await this.prisma.tenantSetting.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...input }, update: input });
    await this.audit.record(ctx, 'club.settings', 'tenant', ctx.tenantId, input);
    return this.club(ctx);
  }

  /**
   * Cashback vencido: zera o que passou da validade. Roda pela rotina diária;
   * conta pelo extrato (créditos vencidos menos o que já foi usado depois deles).
   */
  async expireCashback(tenantId: string): Promise<number> {
    const today = new Date(`${todayBR()}T00:00:00Z`);
    // Créditos vencidos que ainda não foram baixados (a baixa leva o id do crédito na nota).
    const credits = await this.prisma.$queryRaw<Array<{ id: string; customer_id: string; amount: Prisma.Decimal }>>`
      SELECT e.id, e.customer_id, e.amount FROM cashback_entry e
       WHERE e.tenant_id = ${tenantId} AND e.type = 'credito' AND e.expires_at IS NOT NULL AND e.expires_at < ${today}
         AND NOT EXISTS (SELECT 1 FROM cashback_entry v WHERE v.customer_id = e.customer_id AND v.type = 'vencido' AND v.note = e.id)
       ORDER BY e.created_at`;
    let total = 0;
    for (const credit of credits) {
      await this.prisma.$transaction(async (tx) => {
        const c = await tx.$queryRaw<Array<{ cashback_balance: Prisma.Decimal }>>`SELECT cashback_balance FROM customer WHERE id = ${credit.customer_id} FOR UPDATE`;
        if (await tx.cashbackEntry.count({ where: { customerId: credit.customer_id, type: 'vencido', note: credit.id } })) return;
        const balance = Number(c[0]?.cashback_balance ?? 0);
        // Vence no máximo o que ainda sobra de saldo (o resto já foi usado).
        const amount = Math.min(Number(credit.amount), balance);
        if (amount > 0) {
          await moveCashback(tx, { tenantId, customerId: credit.customer_id, type: 'vencido', amount: -amount, note: credit.id });
          total += amount;
        } else {
          await tx.cashbackEntry.create({ data: { tenantId, customerId: credit.customer_id, type: 'vencido', amount: 0, balanceAfter: balance, note: credit.id } });
        }
      });
    }
    return Math.round(total * 100) / 100;
  }

  // ------------------------------------------------------------ apoio

  private searchTerms(q: string | undefined): string[] {
    if (!q) return [];
    return normalizeText(q)
      .split(' ')
      .map((t) => (/^[\d.\-/() ]+$/.test(t) ? onlyDigits(t) : t))
      .filter((t) => t.length >= 2)
      .slice(0, 5);
  }

  private data(input: CustomerInput) {
    return {
      name: input.name,
      document: input.document,
      birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00Z`) : null,
      phone: input.phone,
      email: input.email,
      allowWhatsapp: input.allowWhatsapp,
      goal: input.goal,
      isMember: input.isMember,
      notes: input.notes,
      active: input.active,
      searchText: normalizeText([input.name, input.document, input.phone, input.email].filter(Boolean).join(' ')),
    };
  }

  private async assertDocumentFree(ctx: RequestContext, document: string | null, exceptId: string | null): Promise<void> {
    if (!document) return;
    const other = await this.prisma.customer.findFirst({ where: { tenantId: ctx.tenantId, document, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
    if (other) throw new ConflictError('DOCUMENT_TAKEN', `Esse CPF já está no cadastro de ${other.name}.`);
  }
}

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
