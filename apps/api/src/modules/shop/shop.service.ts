import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  CUSTOMER_GOALS,
  normalizeText,
  todayBR,
  type CustomerGoal,
  type ShopCashbackEntry,
  type ShopCatalog,
  type ShopInfo,
  type ShopLoginInput,
  type ShopLoginResult,
  type ShopMe,
  type ShopPinInput,
  type ShopProduct,
  type ShopProfileInput,
  type ShopPurchase,
  type ShopRepurchase,
  type ShopSignupInput,
  type Unit,
} from '@mercearia/contracts';
import { LoginThrottle } from '../../common/auth/login-throttle';
import type { CustomerTokenPayload } from '../../common/auth/token-payload';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { clubRules } from '../customers/cashback';
import { ensureMemberCode } from '../customers/member-code';
import { loadOptionGroups } from '../products/options';
import { computeRepurchase } from '../growth/repurchase';
import { bestOffer, runningCampaigns } from '../sales/campaign-engine';
import type { CustomerSession } from './customer-auth';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
/** O cliente fica logado no celular; trocar o PIN derruba antes disso. */
const TOKEN_TTL = '90d';

const CASHBACK_LABELS: Record<string, string> = {
  credito: 'Cashback da compra',
  uso: 'Usado na compra',
  estorno: 'Compra cancelada',
  vencido: 'Cashback vencido',
  ajuste: 'Ajuste da loja',
};

interface ShopTenant {
  tenantId: string;
  name: string;
  storeId: string | null;
  stockStoreId: string | null;
  storeName: string;
  phone: string | null;
  address: string | null;
}

const money = (v: number) => Math.round(v * 100) / 100;

/**
 * App do cliente e cardápio. As rotas são públicas (ou com token de cliente),
 * então tudo aqui filtra explicitamente pela organização do endereço (slug) ou
 * do token — nunca por algo que venha do corpo da requisição.
 */
@Injectable()
export class ShopService {
  private readonly throttle = new LoginThrottle(LOCK_AFTER, LOCK_MINUTES * 60_000, LOCK_MINUTES * 60_000);
  /** Muitas contas novas do mesmo aparelho/rede em pouco tempo: freia. */
  private readonly signupThrottle = new LoginThrottle(8, 60 * 60_000, 60 * 60_000);
  private readonly tenants = new Map<string, { at: number; value: ShopTenant }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ---------------------------------------------------------------- vitrine

  async tenant(slug: string): Promise<ShopTenant> {
    const key = String(slug).toLowerCase();
    const cached = this.tenants.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    if (!/^[a-z0-9-]{2,60}$/.test(key)) throw new NotFoundError('loja');
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: key } });
    if (!tenant || tenant.status !== 'active') throw new NotFoundError('loja');
    const store = await this.prisma.store.findFirst({ where: { tenantId: tenant.id, active: true }, orderBy: { createdAt: 'asc' } });
    const value: ShopTenant = {
      tenantId: tenant.id,
      name: tenant.name,
      storeId: store?.id ?? null,
      stockStoreId: store ? (store.stockStoreId ?? store.id) : null,
      storeName: store?.name ?? tenant.name,
      phone: store?.phone ?? null,
      address: store?.address ?? null,
    };
    this.tenants.set(key, { at: Date.now(), value });
    return value;
  }

  async info(slug: string): Promise<ShopInfo> {
    const t = await this.tenant(slug);
    const [club, settings] = await Promise.all([clubRules(this.prisma, t.tenantId), this.prisma.tenantSetting.findUnique({ where: { tenantId: t.tenantId }, select: { ordersEnabled: true } })]);
    const running = await runningCampaigns(this.prisma, t.tenantId);
    const campaigns = running.map((c) => ({ id: c.id, name: c.name, type: c.type as 'cashback' | 'oferta', description: c.description, until: c.endsOn, membersOnly: c.type === 'cashback' || c.audience === 'membros', extraCashbackPct: c.extraCashbackPct }));
    return { slug, name: t.name, storeName: t.storeName, phone: t.phone, address: t.address, club, ordersEnabled: Boolean(t.storeId) && (settings?.ordersEnabled ?? true), campaigns };
  }

  async catalog(slug: string): Promise<ShopCatalog> {
    const t = await this.tenant(slug);
    const products = await this.prisma.product.findMany({
      where: { tenantId: t.tenantId, active: true, sellable: true, showInApp: true, kind: { not: 'insumo' } },
      include: { category: { select: { id: true, name: true, active: true } } },
      orderBy: { name: 'asc' },
      take: 2000,
    });
    const tracked = products.filter((p) => p.trackStock && p.kind !== 'preparado').map((p) => p.id);
    const balances =
      t.stockStoreId && tracked.length
        ? await this.prisma.stockBalance.findMany({ where: { tenantId: t.tenantId, storeId: t.stockStoreId, productId: { in: tracked } } })
        : [];
    const stock = new Map(balances.map((b) => [b.productId, Number(b.quantity)]));
    const groups = await loadOptionGroups(this.prisma, t.tenantId, products.map((p) => p.id));
    const running = await runningCampaigns(this.prisma, t.tenantId);
    const categories = new Map<string, string>();
    const items: ShopProduct[] = products.map((p) => {
      if (p.category?.active) categories.set(p.category.id, p.category.name);
      const price = Number(p.price);
      const member = p.memberPrice == null ? price : Math.min(price, Number(p.memberPrice));
      return {
        id: p.id,
        name: p.name,
        brand: p.brand,
        categoryId: p.category?.active ? p.category.id : null,
        description: p.description,
        imageUrl: p.imageUrl,
        unit: p.unit as Unit,
        soldByWeight: p.soldByWeight,
        price,
        memberPrice: member,
        available: !p.trackStock || p.kind === 'preparado' || (stock.get(p.id) ?? 0) > 0,
        optionGroups: groups.get(p.id) ?? [],
        offer: (() => {
          // A melhor oferta que alguém pode ter (membro ou todos), se baixar o preço.
          const best = bestOffer(running, p.id, true);
          if (!best || best.price >= price) return null;
          const open = bestOffer(running, p.id, false);
          return open && open.price < price ? { name: open.campaign.name, price: open.price, membersOnly: false, until: open.campaign.endsOn } : { name: best.campaign.name, price: best.price, membersOnly: true, until: best.campaign.endsOn };
        })(),
      };
    });
    return {
      categories: [...categories].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      products: items,
    };
  }

  // ---------------------------------------------------------------- entrar

  /**
   * Cadastro pelo app = entrar no clube. Celular novo: cria o cadastro.
   * Celular que a loja já conhece: só vincula se a pessoa provar que é ela
   * (CPF igual ao da ficha) ou se a ficha ainda está vazia (sem compras e sem
   * cashback). Fora isso, pega um código no balcão.
   */
  async signup(slug: string, input: ShopSignupInput, ip: string): Promise<ShopLoginResult> {
    const t = await this.tenant(slug);
    const ipKey = `signup:${ip}`;
    const wait = this.signupThrottle.lockedFor(ipKey);
    if (wait) throw new DomainError('TOO_MANY_SIGNUPS', `Muitos cadastros seguidos. Tente de novo em ${wait} min.`, undefined, 429);
    this.signupThrottle.fail(ipKey);

    const existing = await this.prisma.customer.findFirst({ where: { tenantId: t.tenantId, phone: input.phone }, include: { access: true } });
    if (input.document) {
      const owner = await this.prisma.customer.findFirst({ where: { tenantId: t.tenantId, document: input.document }, select: { id: true } });
      if (owner && owner.id !== existing?.id) throw new ConflictError('CONFIRM_AT_STORE', 'Esse CPF já está em outro cadastro da loja. Fale com a gente no balcão para liberar seu acesso.');
    }

    let customerId: string;
    let joined = false;
    if (existing) {
      if (existing.access) throw new ConflictError('ALREADY_SIGNED_UP', 'Esse celular já tem cadastro no app. Entre com seu PIN (esqueceu? peça um código no balcão).');
      if (!existing.active) throw new ConflictError('CONFIRM_AT_STORE', 'Seu cadastro está pausado. Fale com a gente no balcão.');
      const sameDocument = Boolean(existing.document && input.document && existing.document === input.document);
      const emptyRecord = !existing.document && Number(existing.cashbackBalance) === 0 && (await this.prisma.sale.count({ where: { tenantId: t.tenantId, customerId: existing.id } })) === 0;
      if (!sameDocument && !emptyRecord) {
        throw new ConflictError(
          'CONFIRM_AT_STORE',
          existing.document
            ? 'Esse celular já tem cadastro na loja. Informe o mesmo CPF do cadastro ou peça um código no balcão.'
            : 'Esse celular já tem cadastro na loja. Peça um código no balcão para liberar seu app (é rapidinho).',
        );
      }
      customerId = existing.id;
      joined = !existing.isMember;
    } else {
      customerId = '';
      joined = true;
    }

    const pinHash = await argon2.hash(input.pin);
    const result = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.customer.update({
          where: { id: existing.id },
          data: {
            isMember: true,
            ...(joined ? { memberSince: new Date(), memberSource: 'app' } : {}),
            document: existing.document ?? input.document,
            goal: input.goal ?? existing.goal,
            allowWhatsapp: input.allowWhatsapp,
            birthDate: existing.birthDate ?? (input.birthDate ? new Date(`${input.birthDate}T00:00:00Z`) : null),
          },
        });
      } else {
        const created = await tx.customer.create({
          data: {
            tenantId: t.tenantId,
            name: input.name,
            phone: input.phone,
            document: input.document,
            goal: input.goal,
            allowWhatsapp: input.allowWhatsapp,
            birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00Z`) : null,
            isMember: true,
            memberSince: new Date(),
            memberSource: 'app',
            storeId: t.storeId,
            searchText: normalizeText([input.name, input.document, input.phone].filter(Boolean).join(' ')),
          },
        });
        customerId = created.id;
      }
      await ensureMemberCode(tx, t.tenantId, customerId);
      const access = await tx.customerAccess.create({ data: { customerId, tenantId: t.tenantId, pinHash, lastLoginAt: new Date() } });
      await tx.auditLog.create({ data: { tenantId: t.tenantId, userId: null, action: joined ? 'customer.app_signup' : 'customer.app_access', entity: 'customer', entityId: customerId, data: { source: 'app' } } });
      return access;
    });
    return { token: await this.sign(t.tenantId, customerId, result.version), mustChangePin: false };
  }

  async login(slug: string, input: ShopLoginInput): Promise<ShopLoginResult> {
    const t = await this.tenant(slug);
    const key = `${t.tenantId}:${input.phone}`;
    const wait = this.throttle.lockedFor(key);
    if (wait) throw new DomainError('LOGIN_LOCKED', `Muitas tentativas. Tente de novo em ${wait} min ou peça um código no balcão.`, undefined, 429);

    const customer = await this.prisma.customer.findFirst({ where: { tenantId: t.tenantId, phone: input.phone, active: true }, include: { access: true } });
    const access = customer?.access;
    if (access?.lockedUntil && access.lockedUntil > new Date()) {
      const minutes = Math.ceil((access.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new DomainError('LOGIN_LOCKED', `Muitas tentativas. Tente de novo em ${minutes} min ou peça um código no balcão.`, undefined, 429);
    }
    const ok = access ? await argon2.verify(access.pinHash, input.pin).catch(() => false) : false;
    if (!customer || !access || !ok) {
      this.throttle.fail(key);
      if (access) {
        const failed = access.failedCount + 1;
        await this.prisma.customerAccess.update({
          where: { customerId: access.customerId },
          data: { failedCount: failed >= LOCK_AFTER ? 0 : failed, lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
        });
      }
      throw new DomainError('LOGIN_FAILED', 'Celular ou PIN não confere. Primeira vez? Faça seu cadastro.', undefined, 401);
    }
    this.throttle.succeed(key);
    await this.prisma.customerAccess.update({ where: { customerId: customer.id }, data: { failedCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    return { token: await this.sign(t.tenantId, customer.id, access.version), mustChangePin: access.mustChange };
  }

  /** Cria o PIN (depois do código do balcão) ou troca o PIN. Derruba os outros logins. */
  async changePin(s: CustomerSession, input: ShopPinInput): Promise<ShopLoginResult> {
    const access = await this.prisma.customerAccess.findFirst({ where: { customerId: s.customerId, tenantId: s.tenantId } });
    if (!access) throw new NotFoundError('acesso');
    if (!access.mustChange) {
      const ok = input.current ? await argon2.verify(access.pinHash, input.current).catch(() => false) : false;
      if (!ok) throw new DomainError('PIN_MISMATCH', 'O PIN atual não confere.');
    }
    if (await argon2.verify(access.pinHash, input.pin).catch(() => false)) throw new DomainError('PIN_SAME', 'Escolha um PIN diferente do atual.');
    const updated = await this.prisma.customerAccess.update({
      where: { customerId: s.customerId },
      data: { pinHash: await argon2.hash(input.pin), mustChange: false, version: { increment: 1 }, failedCount: 0, lockedUntil: null },
    });
    return { token: await this.sign(s.tenantId, s.customerId, updated.version), mustChangePin: false };
  }

  // ---------------------------------------------------------------- minha conta

  async me(s: CustomerSession): Promise<ShopMe> {
    const c = await this.prisma.customer.findFirst({ where: { id: s.customerId, tenantId: s.tenantId } });
    if (!c) throw new NotFoundError('cliente');
    const memberCode = c.memberCode ?? (await ensureMemberCode(this.prisma, s.tenantId, c.id));
    const [totals, expiring] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: bigint; savings: Prisma.Decimal | null }>>`
        SELECT COUNT(*) AS count, SUM(member_savings) AS savings
          FROM sale WHERE tenant_id = ${s.tenantId} AND customer_id = ${c.id} AND status = 'completed'`,
      this.expiringSoon(s.tenantId, c.id, Number(c.cashbackBalance)),
    ]);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone ?? '',
      email: c.email,
      goal: (c.goal && c.goal in CUSTOMER_GOALS ? c.goal : null) as CustomerGoal | null,
      allowWhatsapp: c.allowWhatsapp,
      birthDate: c.birthDate?.toISOString().slice(0, 10) ?? null,
      memberCode,
      memberSince: c.memberSince?.toISOString() ?? null,
      cashbackBalance: Number(c.cashbackBalance),
      expiringSoon: expiring,
      totalSavings: money(Number(totals[0]?.savings ?? 0)),
      purchases: Number(totals[0]?.count ?? 0),
      mustChangePin: s.mustChange,
    };
  }

  async updateProfile(s: CustomerSession, input: ShopProfileInput): Promise<ShopMe> {
    const c = await this.prisma.customer.findFirst({ where: { id: s.customerId, tenantId: s.tenantId } });
    if (!c) throw new NotFoundError('cliente');
    await this.prisma.customer.update({
      where: { id: c.id },
      data: {
        name: input.name,
        email: input.email,
        goal: input.goal,
        allowWhatsapp: input.allowWhatsapp,
        birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00Z`) : null,
        searchText: normalizeText([input.name, c.document, c.phone, input.email].filter(Boolean).join(' ')),
      },
    });
    return this.me(s);
  }

  async cashback(s: CustomerSession): Promise<ShopCashbackEntry[]> {
    const rows = await this.prisma.cashbackEntry.findMany({
      where: { tenantId: s.tenantId, customerId: s.customerId, NOT: { type: 'vencido', amount: 0 } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const saleIds = [...new Set(rows.map((r) => r.saleId).filter((v): v is string => Boolean(v)))];
    const sales = saleIds.length ? await this.prisma.sale.findMany({ where: { tenantId: s.tenantId, id: { in: saleIds } }, select: { id: true, number: true } }) : [];
    const numbers = new Map(sales.map((x) => [x.id, x.number]));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      kind: r.type,
      amount: Number(r.amount),
      description: `${CASHBACK_LABELS[r.type] ?? r.type}${r.saleId && numbers.has(r.saleId) ? ` · compra nº ${numbers.get(r.saleId)}` : ''}`,
      expiresAt: r.type === 'credito' ? (r.expiresAt?.toISOString().slice(0, 10) ?? null) : null,
    }));
  }

  async purchases(s: CustomerSession): Promise<ShopPurchase[]> {
    const sales = await this.prisma.sale.findMany({
      where: { tenantId: s.tenantId, customerId: s.customerId },
      include: { items: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return sales.map((x) => ({
      id: x.id,
      number: x.number,
      createdAt: x.createdAt.toISOString(),
      total: Number(x.total) + Number(x.cashbackUsed),
      memberSavings: Number(x.memberSavings),
      cashbackUsed: Number(x.cashbackUsed),
      cashbackEarned: Number(x.cashbackEarned),
      status: x.status,
      items: x.items.map((i) => ({ name: i.description, quantity: Number(i.quantity), unit: i.unit, total: Number(i.total) })),
    }));
  }

  async repurchase(slug: string, s: CustomerSession): Promise<ShopRepurchase[]> {
    const due = await computeRepurchase(this.prisma, s.tenantId, { customerId: s.customerId, ahead: 7, lateMax: 60 });
    if (!due.length) return [];
    const catalog = await this.catalog(slug);
    return due
      .map((d) => {
        const product = catalog.products.find((p) => p.id === d.productId);
        return product ? { product, lastPurchase: d.lastPurchase, dueDate: d.dueDate } : null;
      })
      .filter((r): r is ShopRepurchase => r !== null)
      .slice(0, 6);
  }

  // ---------------------------------------------------------------- apoio

  private sign(tenantId: string, customerId: string, version: number): Promise<string> {
    const payload: CustomerTokenPayload = { sub: customerId, tenantId, kind: 'cliente', v: version };
    return this.jwt.signAsync(payload, { expiresIn: TOKEN_TTL as unknown as number });
  }

  /** Créditos que vencem nos próximos 30 dias (no máximo o saldo que sobra). */
  private async expiringSoon(tenantId: string, customerId: string, balance: number): Promise<ShopMe['expiringSoon']> {
    if (balance <= 0) return null;
    const today = todayBR();
    const from = new Date(`${today}T00:00:00Z`);
    const to = new Date(from.getTime() + 30 * 86_400_000);
    const rows = await this.prisma.$queryRaw<Array<{ amount: Prisma.Decimal | null; first: Date | null }>>`
      SELECT SUM(e.amount) AS amount, MIN(e.expires_at) AS first FROM cashback_entry e
       WHERE e.tenant_id = ${tenantId} AND e.customer_id = ${customerId} AND e.type = 'credito'
         AND e.expires_at IS NOT NULL AND e.expires_at >= ${from} AND e.expires_at <= ${to}
         AND NOT EXISTS (SELECT 1 FROM cashback_entry v WHERE v.customer_id = e.customer_id AND v.type = 'vencido' AND v.note = e.id)`;
    const amount = Math.min(Number(rows[0]?.amount ?? 0), balance);
    if (amount <= 0 || !rows[0]?.first) return null;
    return { amount: money(amount), date: rows[0].first.toISOString().slice(0, 10) };
  }
}
