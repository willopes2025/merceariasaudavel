import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CUSTOMER_GOALS,
  normalizeText,
  todayBR,
  type CustomerGoal,
  type Kit,
  type KitInput,
  type Partner,
  type PartnerCloseInput,
  type PartnerInput,
  type PartnerKind,
  type PartnerMonth,
  type PartnerPortal,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';

const newToken = () => randomBytes(16).toString('hex');
const money = (v: number) => Math.round(v * 100) / 100;

/** Início e fim do mês (AAAA-MM) no horário de Brasília. */
function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1, 3));
  const to = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 3));
  return { from, to };
}

/** Parceiros, comissões do mês, fechamento (conta a pagar), portal e kits. */
@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, month: string): Promise<Partner[]> {
    const rows = await this.prisma.partner.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    const stats = await this.monthStats(ctx.tenantId, rows.map((r) => r.id), month);
    return rows.map((r) => this.toPartner(r, stats.get(r.id) ?? emptyMonth(month)));
  }

  async save(ctx: RequestContext, id: string | null, input: PartnerInput): Promise<Partner> {
    if (id && !(await this.prisma.partner.count({ where: { id, tenantId: ctx.tenantId } }))) throw new NotFoundError('parceiro', id);
    if (await this.prisma.campaign.count({ where: { tenantId: ctx.tenantId, type: 'cupom', code: input.code } })) throw new ConflictError('PARTNER_CODE_TAKEN', `Já existe um cupom com o código ${input.code}. Escolha outro.`);
    let row;
    try {
      row = id ? await this.prisma.partner.update({ where: { id }, data: input }) : await this.prisma.partner.create({ data: { ...input, tenantId: ctx.tenantId, token: newToken() } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictError('PARTNER_CODE_TAKEN', `Já existe um parceiro com o código ${input.code}.`);
      throw e;
    }
    await this.audit.record(ctx, id ? 'partner.update' : 'partner.create', 'partner', row.id, { name: row.name, code: row.code, commissionPct: input.commissionPct });
    const month = todayBR().slice(0, 7);
    return this.toPartner(row, (await this.monthStats(ctx.tenantId, [row.id], month)).get(row.id) ?? emptyMonth(month));
  }

  async rotate(ctx: RequestContext, id: string): Promise<Partner[]> {
    const changed = await this.prisma.partner.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { token: newToken() } });
    if (!changed.count) throw new NotFoundError('parceiro', id);
    return this.list(ctx, todayBR().slice(0, 7));
  }

  /** Fecha a comissão do mês: grava o fechamento e lança a conta a pagar. */
  async close(ctx: RequestContext, id: string, input: PartnerCloseInput): Promise<Partner> {
    const partner = await this.prisma.partner.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!partner) throw new NotFoundError('parceiro', id);
    if (input.month >= todayBR().slice(0, 7)) throw new DomainError('MONTH_OPEN', 'Só dá para fechar mês que já terminou.');
    const s = (await this.monthStats(ctx.tenantId, [id], input.month)).get(id) ?? emptyMonth(input.month);
    if (s.closed) throw new ConflictError('MONTH_CLOSED', 'Esse mês já foi fechado para este parceiro.');
    await this.prisma.$transaction(async (tx) => {
      let payableId: string | null = null;
      if (s.commission > 0) {
        const description = `Comissão ${input.month.split('-').reverse().join('/')} · ${partner.name}`;
        const payable = await tx.payable.create({
          data: { tenantId: ctx.tenantId, description, supplier: partner.name, category: 'folha', amount: s.commission, dueDate: new Date(`${input.dueDate}T00:00:00Z`), searchText: normalizeText(description), createdById: ctx.userId },
        });
        payableId = payable.id;
      }
      await tx.partnerPayout.create({ data: { tenantId: ctx.tenantId, partnerId: id, month: input.month, sales: s.sales, revenue: s.revenue, amount: s.commission, payableId, userId: ctx.userId } });
    });
    await this.audit.record(ctx, 'partner.close', 'partner', id, { month: input.month, amount: s.commission });
    return (await this.list(ctx, input.month)).find((p) => p.id === id)!;
  }

  // ---------------------------------------------------------------- portal (público, pelo link)

  async portal(token: string): Promise<PartnerPortal> {
    if (!/^[a-f0-9]{32}$/.test(token)) throw new NotFoundError('parceiro');
    const p = await this.prisma.partner.findUnique({ where: { token } });
    if (!p || !p.active) throw new NotFoundError('parceiro');
    const [store, tenant, customers, kits] = await Promise.all([
      this.prisma.store.findFirst({ where: { tenantId: p.tenantId, active: true }, orderBy: { createdAt: 'asc' }, select: { name: true } }),
      this.prisma.tenant.findUnique({ where: { id: p.tenantId }, select: { slug: true } }),
      this.prisma.customer.findMany({ where: { tenantId: p.tenantId, partnerId: p.id, active: true }, select: { name: true, partnerSince: true, _count: { select: { sales: { where: { status: 'completed', partnerId: p.id } } } } }, orderBy: { partnerSince: 'desc' }, take: 200 }),
      this.prisma.kit.findMany({ where: { tenantId: p.tenantId, partnerId: p.id, active: true }, select: { id: true, name: true } }),
    ]);
    const now = todayBR().slice(0, 7);
    const months: string[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1 - i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const stats = await Promise.all(months.map(async (m) => (await this.monthStats(p.tenantId, [p.id], m)).get(p.id) ?? emptyMonth(m)));
    void tenant;
    return {
      name: p.name,
      storeName: store?.name ?? '',
      code: p.code,
      customerDiscountPct: p.customerDiscountPct == null ? null : Number(p.customerDiscountPct),
      commissionPct: Number(p.commissionPct),
      signupPath: `/app?ref=${encodeURIComponent(p.code)}`,
      months: stats,
      customers: customers.map((c) => ({ firstName: c.name.split(' ')[0]!, since: (c.partnerSince ?? new Date()).toISOString().slice(0, 10), purchases: c._count.sales })),
      kits: kits.map((k) => ({ id: k.id, name: k.name, path: `/app?ref=${encodeURIComponent(p.code)}&kit=${k.id}` })),
    };
  }

  // ---------------------------------------------------------------- kits

  async kits(ctx: RequestContext): Promise<Kit[]> {
    const rows = await this.prisma.kit.findMany({ where: { tenantId: ctx.tenantId }, include: { items: { orderBy: { position: 'asc' } }, partner: { select: { name: true } } }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    const ids = [...new Set(rows.flatMap((r) => r.items.map((i) => i.productId)))];
    const products = ids.length ? await this.prisma.product.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } }, select: { id: true, name: true, price: true, memberPrice: true } }) : [];
    return rows.map((r) => {
      const items = r.items.map((i) => {
        const p = products.find((x) => x.id === i.productId);
        return { productId: i.productId, name: p?.name ?? '—', quantity: Number(i.quantity), price: Number(p?.price ?? 0), memberPrice: p?.memberPrice == null ? null : Number(p.memberPrice) };
      });
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        goal: (r.goal && r.goal in CUSTOMER_GOALS ? r.goal : null) as CustomerGoal | null,
        partnerId: r.partnerId,
        partnerName: r.partner?.name ?? null,
        imageUrl: r.imageUrl,
        active: r.active,
        items,
        total: money(items.reduce((s, i) => s + i.price * i.quantity, 0)),
        memberTotal: money(items.reduce((s, i) => s + Math.min(i.price, i.memberPrice ?? i.price) * i.quantity, 0)),
      };
    });
  }

  async saveKit(ctx: RequestContext, id: string | null, input: KitInput): Promise<Kit[]> {
    if (id && !(await this.prisma.kit.count({ where: { id, tenantId: ctx.tenantId } }))) throw new NotFoundError('kit', id);
    const ids = input.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw new DomainError('PRODUCT_REPEATED', 'O mesmo produto aparece duas vezes no kit.');
    const products = await this.prisma.product.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } }, select: { id: true, kind: true, sellable: true, name: true } });
    if (products.length !== ids.length) throw new DomainError('PRODUCT_NOT_FOUND', 'Um dos produtos não foi encontrado.');
    const bad = products.find((p) => p.kind === 'insumo' || !p.sellable);
    if (bad) throw new DomainError('PRODUCT_NOT_SELLABLE', `"${bad.name}" é insumo e não entra em kit.`);
    if (input.partnerId && !(await this.prisma.partner.count({ where: { id: input.partnerId, tenantId: ctx.tenantId } }))) throw new DomainError('PARTNER_NOT_FOUND', 'Parceiro não encontrado.');
    const { items, ...data } = input;
    await this.prisma.$transaction(async (tx) => {
      const kit = id ? await tx.kit.update({ where: { id }, data }) : await tx.kit.create({ data: { ...data, tenantId: ctx.tenantId } });
      await tx.kitItem.deleteMany({ where: { kitId: kit.id, tenantId: ctx.tenantId } });
      await tx.kitItem.createMany({ data: items.map((i, n) => ({ tenantId: ctx.tenantId, kitId: kit.id, productId: i.productId, quantity: i.quantity, position: n })) });
    });
    await this.audit.record(ctx, id ? 'kit.update' : 'kit.create', 'kit', id ?? input.name, { name: input.name, items: items.length });
    return this.kits(ctx);
  }

  // ---------------------------------------------------------------- apoio

  private async monthStats(tenantId: string, ids: string[], month: string): Promise<Map<string, PartnerMonth>> {
    const map = new Map<string, PartnerMonth>();
    if (!ids.length) return map;
    const { from, to } = monthRange(month);
    const [sales, customers, fresh, payouts] = await Promise.all([
      this.prisma.$queryRaw<Array<{ partner_id: string; sales: bigint; revenue: Prisma.Decimal; commission: Prisma.Decimal }>>`
        SELECT partner_id, COUNT(*) AS sales, SUM(total - delivery_fee) AS revenue, SUM(partner_commission) AS commission
          FROM sale WHERE tenant_id = ${tenantId} AND status = 'completed' AND partner_id = ANY(${ids}::text[])
           AND created_at >= ${from} AND created_at < ${to}
         GROUP BY partner_id`,
      this.prisma.customer.groupBy({ by: ['partnerId'], where: { tenantId, partnerId: { in: ids } }, _count: true }),
      this.prisma.customer.groupBy({ by: ['partnerId'], where: { tenantId, partnerId: { in: ids }, partnerSince: { gte: from, lt: to } }, _count: true }),
      this.prisma.partnerPayout.findMany({ where: { tenantId, partnerId: { in: ids }, month } }),
    ]);
    for (const id of ids) {
      const s = sales.find((x) => x.partner_id === id);
      const payout = payouts.find((x) => x.partnerId === id);
      map.set(id, {
        month,
        customers: customers.find((x) => x.partnerId === id)?._count ?? 0,
        newCustomers: fresh.find((x) => x.partnerId === id)?._count ?? 0,
        sales: payout ? payout.sales : Number(s?.sales ?? 0),
        revenue: payout ? Number(payout.revenue) : money(Number(s?.revenue ?? 0)),
        commission: payout ? Number(payout.amount) : money(Number(s?.commission ?? 0)),
        closed: Boolean(payout),
      });
    }
    return map;
  }

  private toPartner(r: Prisma.PartnerGetPayload<object>, stats: PartnerMonth): Partner {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind as PartnerKind,
      document: r.document,
      phone: r.phone,
      email: r.email,
      code: r.code,
      customerDiscountPct: r.customerDiscountPct == null ? null : Number(r.customerDiscountPct),
      commissionPct: Number(r.commissionPct),
      notes: r.notes,
      active: r.active,
      path: `/parceiro/${r.token}`,
      stats,
    };
  }
}

function emptyMonth(month: string): PartnerMonth {
  return { month, customers: 0, newCustomers: 0, sales: 0, revenue: 0, commission: 0, closed: false };
}
