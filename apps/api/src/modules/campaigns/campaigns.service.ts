import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { campaignRunsOn, type Campaign, type CampaignAudience, type CampaignInput, type CampaignType } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';
import { brToday } from '../sales/campaign-engine';

const include = { items: true } satisfies Prisma.CampaignInclude;
type Row = Prisma.CampaignGetPayload<{ include: typeof include }>;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (v: number) => Math.round(v * 100) / 100;

/** Campanhas: cadastro, liga/desliga e o resultado de cada uma. */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext): Promise<Campaign[]> {
    const rows = await this.prisma.campaign.findMany({ where: { tenantId: ctx.tenantId }, include, orderBy: [{ active: 'desc' }, { endsOn: 'desc' }], take: 300 });
    return this.toCampaigns(ctx.tenantId, rows);
  }

  async get(ctx: RequestContext, id: string): Promise<Campaign> {
    const row = await this.prisma.campaign.findFirst({ where: { id, tenantId: ctx.tenantId }, include });
    if (!row) throw new NotFoundError('campanha', id);
    return (await this.toCampaigns(ctx.tenantId, [row]))[0]!;
  }

  async save(ctx: RequestContext, id: string | null, input: CampaignInput): Promise<Campaign> {
    if (id && !(await this.prisma.campaign.count({ where: { id, tenantId: ctx.tenantId } }))) throw new NotFoundError('campanha', id);
    const productIds = input.products.map((p) => p.productId);
    if (productIds.length) {
      const found = await this.prisma.product.count({ where: { tenantId: ctx.tenantId, id: { in: productIds } } });
      if (found !== new Set(productIds).size) throw new DomainError('PRODUCT_NOT_FOUND', 'Um dos produtos não foi encontrado.');
    }
    if (input.categoryIds.length) {
      const found = await this.prisma.productCategory.count({ where: { tenantId: ctx.tenantId, id: { in: input.categoryIds } } });
      if (found !== new Set(input.categoryIds).size) throw new DomainError('CATEGORY_NOT_FOUND', 'Uma das categorias não foi encontrada.');
    }
    const isCoupon = input.type === 'cupom';
    const data = {
      name: input.name,
      type: input.type,
      active: input.active,
      startsOn: new Date(`${input.startsOn}T00:00:00Z`),
      endsOn: new Date(`${input.endsOn}T00:00:00Z`),
      weekdays: [...new Set(input.weekdays)].sort(),
      audience: input.audience,
      description: input.description,
      code: isCoupon ? input.code : null,
      discountPct: isCoupon ? input.discountPct : null,
      discountAmount: isCoupon ? input.discountAmount : null,
      minPurchase: isCoupon ? input.minPurchase : 0,
      maxUses: isCoupon ? input.maxUses : null,
      maxPerCustomer: isCoupon ? input.maxPerCustomer : null,
      extraCashbackPct: input.type === 'cashback' ? input.extraCashbackPct : null,
      scope: input.type === 'oferta' ? 'produtos' : input.type === 'cashback' ? input.scope : 'tudo',
    };
    const items: Array<{ productId?: string; categoryId?: string; promoPrice?: number | null }> =
      input.type === 'oferta'
        ? input.products.map((p) => ({ productId: p.productId, promoPrice: p.promoPrice }))
        : input.type === 'cashback' && input.scope === 'produtos'
          ? input.products.map((p) => ({ productId: p.productId }))
          : input.type === 'cashback' && input.scope === 'categorias'
            ? input.categoryIds.map((categoryId) => ({ categoryId }))
            : [];
    let savedId: string;
    try {
      savedId = await this.prisma.$transaction(async (tx) => {
        const row = id ? await tx.campaign.update({ where: { id }, data }) : await tx.campaign.create({ data: { ...data, tenantId: ctx.tenantId } });
        await tx.campaignItem.deleteMany({ where: { campaignId: row.id, tenantId: ctx.tenantId } });
        if (items.length) await tx.campaignItem.createMany({ data: items.map((i) => ({ tenantId: ctx.tenantId, campaignId: row.id, productId: i.productId ?? null, categoryId: i.categoryId ?? null, promoPrice: i.promoPrice ?? null })) });
        return row.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictError('COUPON_CODE_TAKEN', `Já existe um cupom com o código ${input.code}.`);
      throw e;
    }
    await this.audit.record(ctx, id ? 'campaign.update' : 'campaign.create', 'campaign', savedId, { name: input.name, type: input.type, active: input.active });
    return this.get(ctx, savedId);
  }

  private async toCampaigns(tenantId: string, rows: Row[]): Promise<Campaign[]> {
    if (!rows.length) return [];
    const productIds = [...new Set(rows.flatMap((r) => r.items.map((i) => i.productId)).filter((v): v is string => Boolean(v)))];
    const categoryIds = [...new Set(rows.flatMap((r) => r.items.map((i) => i.categoryId)).filter((v): v is string => Boolean(v)))];
    const ids = rows.map((r) => r.id);
    const [products, categories, couponStats, offerStats] = await Promise.all([
      productIds.length ? this.prisma.product.findMany({ where: { tenantId, id: { in: productIds } }, select: { id: true, name: true, price: true, memberPrice: true } }) : [],
      categoryIds.length ? this.prisma.productCategory.findMany({ where: { tenantId, id: { in: categoryIds } }, select: { id: true, name: true } }) : [],
      this.prisma.sale.groupBy({ by: ['couponId'], where: { tenantId, couponId: { in: ids }, status: 'completed' }, _count: true, _sum: { total: true, couponDiscount: true } }),
      this.prisma.$queryRaw<Array<{ campaign_id: string; sales: bigint; revenue: Prisma.Decimal; savings: Prisma.Decimal }>>`
        SELECT si.campaign_id, COUNT(DISTINCT si.sale_id) AS sales, SUM(si.total) AS revenue, SUM(si.promo_savings) AS savings
          FROM sale_item si JOIN sale s ON s.id = si.sale_id
         WHERE si.tenant_id = ${tenantId} AND s.status = 'completed' AND si.campaign_id = ANY(${ids}::text[])
         GROUP BY si.campaign_id`,
    ]);
    const t = brToday();
    const out: Campaign[] = [];
    for (const r of rows) {
      let stats = { sales: 0, revenue: 0, discount: 0, cashback: 0 };
      if (r.type === 'cupom') {
        const s = couponStats.find((x) => x.couponId === r.id);
        if (s) stats = { sales: s._count, revenue: money(Number(s._sum.total ?? 0)), discount: money(Number(s._sum.couponDiscount ?? 0)), cashback: 0 };
      } else if (r.type === 'oferta') {
        const s = offerStats.find((x) => x.campaign_id === r.id);
        if (s) stats = { sales: Number(s.sales), revenue: money(Number(s.revenue)), discount: money(Number(s.savings)), cashback: 0 };
      } else {
        // Cashback turbinado: vendas do período que ganharam cashback de campanha.
        const agg = await this.prisma.sale.aggregate({
          where: { tenantId, status: 'completed', campaignCashback: { gt: 0 }, createdAt: { gte: new Date(`${iso(r.startsOn)}T03:00:00Z`), lt: new Date(r.endsOn.getTime() + 27 * 3_600_000) } },
          _count: true,
          _sum: { total: true, campaignCashback: true },
        });
        stats = { sales: agg._count, revenue: money(Number(agg._sum.total ?? 0)), discount: 0, cashback: money(Number(agg._sum.campaignCashback ?? 0)) };
      }
      const c = { active: r.active, startsOn: iso(r.startsOn), endsOn: iso(r.endsOn), weekdays: r.weekdays };
      out.push({
        id: r.id,
        name: r.name,
        type: r.type as CampaignType,
        ...c,
        audience: r.audience as CampaignAudience,
        description: r.description,
        code: r.code,
        discountPct: r.discountPct == null ? null : Number(r.discountPct),
        discountAmount: r.discountAmount == null ? null : Number(r.discountAmount),
        minPurchase: Number(r.minPurchase),
        maxUses: r.maxUses,
        maxPerCustomer: r.maxPerCustomer,
        extraCashbackPct: r.extraCashbackPct == null ? null : Number(r.extraCashbackPct),
        scope: r.scope as Campaign['scope'],
        categories: r.items.filter((i) => i.categoryId).map((i) => ({ id: i.categoryId!, name: categories.find((x) => x.id === i.categoryId)?.name ?? '—' })),
        products: r.items
          .filter((i) => i.productId)
          .map((i) => {
            const p = products.find((x) => x.id === i.productId);
            return { productId: i.productId!, name: p?.name ?? '—', price: Number(p?.price ?? 0), memberPrice: p?.memberPrice == null ? null : Number(p.memberPrice), promoPrice: i.promoPrice == null ? null : Number(i.promoPrice) };
          }),
        runningNow: campaignRunsOn(c, t.day, t.weekday),
        stats,
      });
    }
    return out;
  }
}
