import { Injectable, Logger } from '@nestjs/common';
import {
  originMedium,
  originSource,
  productPath,
  type Origin,
  type OriginReport,
  type OriginRow,
  type StorefrontSettings,
  type StorefrontSettingsInput,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { PaymentGateway } from '../../common/payments/payment-gateway';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ShopService } from '../shop/shop.service';

const money = (v: number) => Math.round(v * 100) / 100;
const SLUG = () => process.env.SHOP_SLUG?.trim() || 'mercearia-saudavel';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface PageMeta {
  title: string;
  description: string;
  url: string;
  image: string | null;
  jsonLd: Record<string, unknown>;
}

/** Configuração da vitrine, relatório de origem das vendas e SEO das páginas públicas. */
@Injectable()
export class StorefrontService {
  private readonly logger = new Logger('Loja online');

  constructor(
    private readonly prisma: PrismaService,
    private readonly shop: ShopService,
    private readonly gateway: PaymentGateway,
    private readonly audit: AuditService,
  ) {}

  private base(): string {
    return this.gateway.publicUrl() ?? 'https://mercearia.wideic.com';
  }

  async settings(ctx: RequestContext): Promise<StorefrontSettings> {
    const s = await this.prisma.tenantSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { shopDescription: true, metaPixelId: true, ga4Id: true } });
    return { shopDescription: s?.shopDescription ?? null, metaPixelId: s?.metaPixelId ?? null, ga4Id: s?.ga4Id ?? null, url: `${this.base()}/loja` };
  }

  async saveSettings(ctx: RequestContext, input: StorefrontSettingsInput): Promise<StorefrontSettings> {
    await this.prisma.tenantSetting.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...input }, update: input });
    await this.audit.record(ctx, 'settings.storefront', 'tenant', ctx.tenantId, input);
    return this.settings(ctx);
  }

  /** Pedidos do app/loja e cadastros por origem (utm_source / medium / campanha). */
  async origins(ctx: RequestContext, days: number): Promise<OriginReport> {
    const from = new Date(Date.now() - days * 86_400_000);
    const [orders, customers] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId: ctx.tenantId, channel: 'app', createdAt: { gte: from } },
        select: { origin: true, sale: { select: { status: true, total: true, deliveryFee: true } } },
        take: 50_000,
      }),
      this.prisma.customer.findMany({ where: { tenantId: ctx.tenantId, memberSource: 'app', memberSince: { gte: from } }, select: { origin: true }, take: 50_000 }),
    ]);
    const rows = new Map<string, OriginRow>();
    const row = (o: Origin | null) => {
      const source = originSource(o);
      const medium = originMedium(o);
      const campaign = o?.campaign ?? '';
      const key = `${source}|${medium}|${campaign}`;
      let r = rows.get(key);
      if (!r) rows.set(key, (r = { source, medium, campaign, orders: 0, paidOrders: 0, revenue: 0, newCustomers: 0 }));
      return r;
    };
    for (const o of orders) {
      const r = row(o.origin as Origin | null);
      r.orders++;
      if (o.sale?.status === 'completed') {
        r.paidOrders++;
        r.revenue = money(r.revenue + Number(o.sale.total) - Number(o.sale.deliveryFee));
      }
    }
    for (const c of customers) row(c.origin as Origin | null).newCustomers++;
    const list = [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || b.newCustomers - a.newCustomers);
    const totals = list.reduce((t, r) => ({ orders: t.orders + r.orders, paidOrders: t.paidOrders + r.paidOrders, revenue: money(t.revenue + r.revenue), newCustomers: t.newCustomers + r.newCustomers }), { orders: 0, paidOrders: 0, revenue: 0, newCustomers: 0 });
    return { days, rows: list, totals };
  }

  // ---------------------------------------------------------------- SEO (páginas públicas)

  /** Título, descrição, foto e dados estruturados da página (null = página sem SEO próprio). */
  async pageMeta(path: string): Promise<PageMeta | null> {
    const clean = path.replace(/\/+$/, '') || '/';
    try {
      if (clean === '/loja') return await this.storeMeta();
      const m = clean.match(/^\/loja\/p\/([0-9a-f-]{36})(?:\/[\w-]*)?$/);
      if (m) return await this.productMeta(m[1]!);
    } catch (e) {
      this.logger.warn(`SEO de ${path}: ${(e as Error).message}`);
    }
    return null;
  }

  /** Troca o <title> do index.html pelas tags da página. */
  inject(html: string, meta: PageMeta): string {
    const tags = [
      `<title>${esc(meta.title)}</title>`,
      `<meta name="description" content="${esc(meta.description)}" />`,
      `<link rel="canonical" href="${esc(meta.url)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${esc(meta.title)}" />`,
      `<meta property="og:description" content="${esc(meta.description)}" />`,
      `<meta property="og:url" content="${esc(meta.url)}" />`,
      `<meta property="og:locale" content="pt_BR" />`,
      meta.image ? `<meta property="og:image" content="${esc(meta.image)}" />` : '',
      `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" />`,
      `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>`,
    ].filter(Boolean);
    return html.replace(/<title>[^<]*<\/title>/, tags.join('\n    '));
  }

  async sitemap(): Promise<string> {
    const catalog = await this.shop.catalog(SLUG());
    const base = this.base();
    const urls = [`${base}/loja`, ...catalog.products.map((p) => base + productPath(p))];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
  }

  robots(): string {
    return `User-agent: *\nAllow: /loja\nDisallow: /\nSitemap: ${this.base()}/sitemap.xml\n`;
  }

  private async storeMeta(): Promise<PageMeta> {
    const [info, catalog] = await Promise.all([this.shop.info(SLUG()), this.shop.catalog(SLUG())]);
    const description = info.description ?? `Suplementos, produtos Pacco, shakes e alimentos saudáveis. Compre online e retire na loja${info.delivery.enabled ? ' ou receba em casa' : ''}. Membro do clube paga menos.`;
    return {
      title: `${info.storeName || info.name} · loja online`,
      description: description.slice(0, 300),
      url: `${this.base()}/loja`,
      image: catalog.products.find((p) => p.imageUrl)?.imageUrl ?? null,
      jsonLd: { '@context': 'https://schema.org', '@type': 'Store', name: info.storeName || info.name, url: `${this.base()}/loja`, telephone: info.phone ?? undefined, address: info.address ?? undefined },
    };
  }

  private async productMeta(id: string): Promise<PageMeta | null> {
    const [info, catalog] = await Promise.all([this.shop.info(SLUG()), this.shop.catalog(SLUG())]);
    const p = catalog.products.find((x) => x.id === id);
    if (!p) return null;
    const price = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
    const member = p.memberPrice < p.price ? ` Membro do clube paga ${price(p.memberPrice)}.` : '';
    const description = `${p.description ? `${p.description} ` : ''}${price(p.price)}.${member} Compre na ${info.storeName || info.name}.`;
    const url = this.base() + productPath(p);
    return {
      title: `${p.name}${p.brand ? ` · ${p.brand}` : ''} | ${info.storeName || info.name}`,
      description: description.slice(0, 300),
      url,
      image: p.imageUrl,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name,
        description: p.description ?? undefined,
        image: p.imageUrl ?? undefined,
        brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
        offers: { '@type': 'Offer', priceCurrency: 'BRL', price: p.price.toFixed(2), availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url },
      },
    };
  }
}
