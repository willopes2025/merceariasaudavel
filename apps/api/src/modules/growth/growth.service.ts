import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_MESSAGES,
  couponSummary,
  todayBR,
  type BirthdayRow,
  type ContactInput,
  type GrowthMessages,
  type GrowthMessagesInput,
  type GrowthSummary,
  type LapsedRow,
  type RepurchaseRow,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';
import { computeRepurchase } from './repurchase';

const DAY = 86_400_000;

/** Recompra, clientes sumidas e aniversariantes, com o registro de contato. */
@Injectable()
export class GrowthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async summary(ctx: RequestContext): Promise<GrowthSummary> {
    const month = Number(todayBR().slice(5, 7));
    const [repurchase, lapsed, birthdays, messages, coupon] = await Promise.all([
      computeRepurchase(this.prisma, ctx.tenantId),
      this.lapsed(ctx, 45),
      this.birthdays(ctx, month),
      this.messages(ctx),
      this.birthdayCoupon(ctx.tenantId),
    ]);
    return {
      repurchaseDue: repurchase.filter((r) => !r.lastContactAt).length,
      lapsed: lapsed.filter((r) => !r.lastContactAt).length,
      birthdays: birthdays.filter((r) => !r.lastContactAt).length,
      birthdayCoupon: coupon,
      appUrl: null,
      messages,
    };
  }

  repurchase(ctx: RequestContext, ahead: number): Promise<RepurchaseRow[]> {
    return computeRepurchase(this.prisma, ctx.tenantId, { ahead });
  }

  /** Comprou antes e não volta há `days` dias (até 1 ano). */
  async lapsed(ctx: RequestContext, days: number): Promise<LapsedRow[]> {
    const rows = await this.prisma.$queryRaw<Array<{ customer_id: string; purchases: bigint; total: Prisma.Decimal; last: Date }>>`
      SELECT customer_id, COUNT(*) AS purchases, SUM(total + cashback_used) AS total, MAX(created_at) AS last
        FROM sale WHERE tenant_id = ${ctx.tenantId} AND status = 'completed' AND customer_id IS NOT NULL
       GROUP BY customer_id
      HAVING MAX(created_at) < now() - make_interval(days => ${days}) AND MAX(created_at) >= now() - interval '365 days'`;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.customer_id);
    const [customers, contacts] = await Promise.all([
      this.prisma.customer.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids }, active: true } }),
      this.prisma.customerContact.findMany({ where: { tenantId: ctx.tenantId, kind: 'sumida', customerId: { in: ids } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const now = Date.now();
    return rows
      .map((r) => {
        const c = customers.find((x) => x.id === r.customer_id);
        if (!c) return null;
        const contact = contacts.find((x) => x.customerId === c.id && x.createdAt >= r.last);
        return {
          customerId: c.id,
          customerName: c.name,
          phone: c.phone,
          allowWhatsapp: c.allowWhatsapp,
          isMember: c.isMember,
          cashbackBalance: Number(c.cashbackBalance),
          purchases: Number(r.purchases),
          totalSpent: Math.round(Number(r.total) * 100) / 100,
          lastPurchase: r.last.toISOString(),
          daysAway: Math.floor((now - r.last.getTime()) / DAY),
          lastContactAt: contact?.createdAt.toISOString() ?? null,
        } satisfies LapsedRow;
      })
      .filter((r): r is LapsedRow => r !== null)
      .sort((a, b) => Number(Boolean(a.lastContactAt)) - Number(Boolean(b.lastContactAt)) || b.totalSpent - a.totalSpent);
  }

  async birthdays(ctx: RequestContext, month: number): Promise<BirthdayRow[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM customer WHERE tenant_id = ${ctx.tenantId} AND active AND birth_date IS NOT NULL AND EXTRACT(MONTH FROM birth_date) = ${month}`;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const year = todayBR().slice(0, 4);
    const [customers, contacts] = await Promise.all([
      this.prisma.customer.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } } }),
      this.prisma.customerContact.findMany({ where: { tenantId: ctx.tenantId, kind: 'aniversario', customerId: { in: ids }, createdAt: { gte: new Date(`${year}-01-01T03:00:00Z`) } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return customers
      .map((c) => ({
        customerId: c.id,
        customerName: c.name,
        phone: c.phone,
        allowWhatsapp: c.allowWhatsapp,
        isMember: c.isMember,
        birthDate: c.birthDate!.toISOString().slice(0, 10),
        day: c.birthDate!.getUTCDate(),
        lastContactAt: contacts.find((x) => x.customerId === c.id)?.createdAt.toISOString() ?? null,
      }))
      .sort((a, b) => a.day - b.day);
  }

  async contact(ctx: RequestContext, input: ContactInput): Promise<{ ok: true }> {
    const c = await this.prisma.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!c) throw new NotFoundError('cliente', input.customerId);
    await this.prisma.customerContact.create({ data: { tenantId: ctx.tenantId, customerId: c.id, productId: input.productId ?? null, kind: input.kind, userId: ctx.userId } });
    return { ok: true };
  }

  async messages(ctx: RequestContext): Promise<GrowthMessages> {
    const s = await this.prisma.tenantSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { msgRepurchase: true, msgLapsed: true, msgBirthday: true } });
    return { repurchase: s?.msgRepurchase || DEFAULT_MESSAGES.repurchase, lapsed: s?.msgLapsed || DEFAULT_MESSAGES.lapsed, birthday: s?.msgBirthday || DEFAULT_MESSAGES.birthday };
  }

  async saveMessages(ctx: RequestContext, input: GrowthMessagesInput): Promise<GrowthMessages> {
    const data = { msgRepurchase: input.repurchase, msgLapsed: input.lapsed, msgBirthday: input.birthday };
    await this.prisma.tenantSetting.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
    await this.audit.record(ctx, 'growth.messages', 'tenant', ctx.tenantId, {});
    return this.messages(ctx);
  }

  private async birthdayCoupon(tenantId: string): Promise<GrowthSummary['birthdayCoupon']> {
    const today = new Date(`${todayBR()}T00:00:00Z`);
    const c = await this.prisma.campaign.findFirst({ where: { tenantId, type: 'cupom', audience: 'aniversariantes', active: true, startsOn: { lte: today }, endsOn: { gte: today } }, orderBy: { createdAt: 'desc' } });
    if (!c?.code) return null;
    return { code: c.code, summary: couponSummary({ discountPct: c.discountPct == null ? null : Number(c.discountPct), discountAmount: c.discountAmount == null ? null : Number(c.discountAmount), minPurchase: Number(c.minPurchase), maxPerCustomer: c.maxPerCustomer ?? 1 }) };
  }
}
