import { Prisma } from '@prisma/client';
import { couponSummary, todayBR } from '@mercearia/contracts';

type Db = Pick<Prisma.TransactionClient, 'campaign' | 'sale'>;

export interface RunningCampaign {
  id: string;
  name: string;
  type: 'cupom' | 'cashback' | 'oferta';
  audience: 'todos' | 'membros' | 'aniversariantes';
  code: string | null;
  discountPct: number | null;
  discountAmount: number | null;
  minPurchase: number;
  maxUses: number | null;
  maxPerCustomer: number | null;
  extraCashbackPct: number | null;
  scope: 'tudo' | 'categorias' | 'produtos';
  description: string | null;
  endsOn: string;
  productIds: Set<string>;
  categoryIds: Set<string>;
  promo: Map<string, number>;
}

/** Dia e dia da semana no horário de Brasília. */
export function brToday(): { day: string; weekday: number; month: number; year: number } {
  const day = todayBR();
  const d = new Date(`${day}T12:00:00Z`);
  return { day, weekday: d.getUTCDay(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

type Row = Prisma.CampaignGetPayload<{ include: { items: true } }>;

function toRunning(c: Row): RunningCampaign {
  return {
    id: c.id,
    name: c.name,
    type: c.type as RunningCampaign['type'],
    audience: c.audience as RunningCampaign['audience'],
    code: c.code,
    discountPct: c.discountPct == null ? null : Number(c.discountPct),
    discountAmount: c.discountAmount == null ? null : Number(c.discountAmount),
    minPurchase: Number(c.minPurchase),
    maxUses: c.maxUses,
    maxPerCustomer: c.maxPerCustomer,
    extraCashbackPct: c.extraCashbackPct == null ? null : Number(c.extraCashbackPct),
    scope: c.scope as RunningCampaign['scope'],
    description: c.description,
    endsOn: iso(c.endsOn),
    productIds: new Set(c.items.map((i) => i.productId).filter((v): v is string => Boolean(v))),
    categoryIds: new Set(c.items.map((i) => i.categoryId).filter((v): v is string => Boolean(v))),
    promo: new Map(c.items.filter((i) => i.productId && i.promoPrice != null).map((i) => [i.productId!, Number(i.promoPrice)])),
  };
}

/** Campanhas de oferta e cashback rodando hoje (cupom só entra quando digitado). */
export async function runningCampaigns(db: Db, tenantId: string): Promise<RunningCampaign[]> {
  const t = brToday();
  const today = new Date(`${t.day}T00:00:00Z`);
  const rows = await db.campaign.findMany({
    where: { tenantId, active: true, type: { in: ['oferta', 'cashback'] }, startsOn: { lte: today }, endsOn: { gte: today } },
    include: { items: true },
  });
  return rows.filter((r) => !r.weekdays.length || r.weekdays.includes(t.weekday)).map(toRunning);
}

/** Linha vale para a campanha (escopo tudo / categorias / produtos). */
export function lineInScope(c: RunningCampaign, productId: string, categoryId: string | null): boolean {
  if (c.scope === 'tudo') return true;
  if (c.scope === 'produtos') return c.productIds.has(productId);
  return Boolean(categoryId && c.categoryIds.has(categoryId));
}

/** Melhor oferta para o produto (menor preço promocional que a cliente pode ter). */
export function bestOffer(campaigns: RunningCampaign[], productId: string, member: boolean): { campaign: RunningCampaign; price: number } | null {
  let best: { campaign: RunningCampaign; price: number } | null = null;
  for (const c of campaigns) {
    if (c.type !== 'oferta' || (c.audience === 'membros' && !member)) continue;
    const price = c.promo.get(productId);
    if (price != null && (!best || price < best.price)) best = { campaign: c, price };
  }
  return best;
}

export interface CouponCheck {
  campaign: RunningCampaign | null;
  error: string | null;
}

interface CouponCustomer {
  id: string;
  isMember: boolean;
  birthDate: Date | null;
}

/**
 * Confere o cupom digitado: existe, está ligado, no período e no dia,
 * público certo, compra mínima e limites de uso (total e por cliente).
 * `lock` trava a linha do cupom (dentro da transação da venda) para o
 * limite de uso não estourar com duas vendas ao mesmo tempo.
 */
export async function checkCoupon(db: Db & { $queryRaw?: Prisma.TransactionClient['$queryRaw'] }, tenantId: string, code: string, customer: CouponCustomer | null, subtotal: number, lock = false): Promise<CouponCheck> {
  const row = await db.campaign.findFirst({ where: { tenantId, type: 'cupom', code: code.toUpperCase() }, include: { items: true } });
  if (!row) return { campaign: null, error: 'Cupom não encontrado.' };
  if (lock && db.$queryRaw) await db.$queryRaw`SELECT id FROM campaign WHERE id = ${row.id} FOR UPDATE`;
  const c = toRunning(row);
  const t = brToday();
  if (!row.active) return { campaign: null, error: 'Esse cupom está desativado.' };
  if (iso(row.startsOn) > t.day) return { campaign: null, error: `Esse cupom só vale a partir de ${iso(row.startsOn).split('-').reverse().join('/')}.` };
  if (iso(row.endsOn) < t.day) return { campaign: null, error: 'Esse cupom já venceu.' };
  if (row.weekdays.length && !row.weekdays.includes(t.weekday)) return { campaign: null, error: 'Esse cupom não vale hoje (dia da semana).' };
  if (c.audience !== 'todos' && !customer) return { campaign: null, error: 'Identifique a cliente para usar esse cupom.' };
  if (c.audience === 'membros' && !customer?.isMember) return { campaign: null, error: 'Cupom só para membros do clube.' };
  if (c.audience === 'aniversariantes') {
    const bd = customer?.birthDate;
    if (!bd) return { campaign: null, error: 'Cupom de aniversário: cadastre a data de nascimento da cliente.' };
    if (bd.getUTCMonth() + 1 !== t.month) return { campaign: null, error: 'Cupom de aniversário vale só no mês do aniversário.' };
  }
  if (subtotal < c.minPurchase) return { campaign: null, error: `Cupom vale para compras a partir de R$ ${c.minPurchase.toFixed(2).replace('.', ',')}.` };
  if (c.maxUses != null) {
    const used = await db.sale.count({ where: { tenantId, couponId: c.id, status: 'completed' } });
    if (used >= c.maxUses) return { campaign: null, error: 'Esse cupom já atingiu o limite de usos.' };
  }
  const perCustomer = c.maxPerCustomer ?? (c.audience === 'aniversariantes' ? 1 : null);
  if (perCustomer != null) {
    if (!customer) return { campaign: null, error: 'Identifique a cliente para usar esse cupom.' };
    const since = c.audience === 'aniversariantes' ? new Date(`${t.year}-01-01T03:00:00Z`) : undefined;
    const used = await db.sale.count({ where: { tenantId, couponId: c.id, customerId: customer.id, status: 'completed', ...(since ? { createdAt: { gte: since } } : {}) } });
    if (used >= perCustomer) return { campaign: null, error: perCustomer === 1 ? 'A cliente já usou esse cupom.' : `A cliente já usou esse cupom ${used} vezes (limite ${perCustomer}).` };
  }
  return { campaign: c, error: null };
}

/** Desconto do cupom em centavos sobre o valor depois do desconto manual. */
export function couponCents(c: RunningCampaign, baseCents: number): number {
  if (baseCents <= 0) return 0;
  if (c.discountPct != null) return Math.min(baseCents, Math.floor((baseCents * c.discountPct) / 100));
  return Math.min(baseCents, Math.round((c.discountAmount ?? 0) * 100));
}

/** Aniversariante do mês com cupom de aniversário ainda não usado este ano. */
export async function birthdaySuggestion(db: Db, tenantId: string, customer: CouponCustomer | null): Promise<{ code: string; name: string; summary: string } | null> {
  if (!customer?.birthDate) return null;
  const t = brToday();
  if (customer.birthDate.getUTCMonth() + 1 !== t.month) return null;
  const today = new Date(`${t.day}T00:00:00Z`);
  const coupons = await db.campaign.findMany({ where: { tenantId, type: 'cupom', audience: 'aniversariantes', active: true, startsOn: { lte: today }, endsOn: { gte: today } }, include: { items: true } });
  for (const row of coupons) {
    if (row.weekdays.length && !row.weekdays.includes(t.weekday)) continue;
    const used = await db.sale.count({ where: { tenantId, couponId: row.id, customerId: customer.id, status: 'completed', createdAt: { gte: new Date(`${t.year}-01-01T03:00:00Z`) } } });
    if (used < (row.maxPerCustomer ?? 1) && row.code) {
      const c = toRunning(row);
      return { code: row.code, name: row.name, summary: couponSummary(c) };
    }
  }
  return null;
}
