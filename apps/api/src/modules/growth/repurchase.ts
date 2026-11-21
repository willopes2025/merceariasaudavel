import { Prisma } from '@prisma/client';
import { todayBR, type RepurchaseRow } from '@mercearia/contracts';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | 'product' | 'customer' | 'customerContact'>;

const DAY = 86_400_000;
const dayNum = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/**
 * Quem deve estar para repor cada produto de revenda. O intervalo é o da
 * própria cliente (mediana entre as compras, com pelo menos 2 compras) ou,
 * sem histórico, a duração do produto ("dura em média X dias").
 * Entra quem vence nos próximos `ahead` dias ou já passou até `lateMax` dias
 * (mais que isso é cliente sumida, outra lista).
 */
export async function computeRepurchase(db: Db, tenantId: string, opts: { customerId?: string; ahead?: number; lateMax?: number } = {}): Promise<RepurchaseRow[]> {
  const ahead = opts.ahead ?? 7;
  const lateMax = opts.lateMax ?? 45;
  const customerFilter = opts.customerId ? Prisma.sql`AND s.customer_id = ${opts.customerId}` : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ customer_id: string; product_id: string; days: string[] }>>`
    SELECT customer_id, product_id, array_agg(d ORDER BY d) AS days FROM (
      SELECT DISTINCT s.customer_id, si.product_id, to_char((s.created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d
        FROM sale_item si JOIN sale s ON s.id = si.sale_id
       WHERE s.tenant_id = ${tenantId} AND s.status = 'completed' AND s.customer_id IS NOT NULL
         AND si.kind = 'revenda' AND s.created_at >= now() - interval '400 days' ${customerFilter}
    ) x GROUP BY customer_id, product_id`;
  if (!rows.length) return [];
  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  const [products, customers, contacts] = await Promise.all([
    db.product.findMany({ where: { tenantId, id: { in: productIds }, active: true }, select: { id: true, name: true, repurchaseDays: true } }),
    db.customer.findMany({ where: { tenantId, id: { in: customerIds }, active: true }, select: { id: true, name: true, phone: true, allowWhatsapp: true, isMember: true, cashbackBalance: true } }),
    db.customerContact.findMany({ where: { tenantId, kind: 'recompra', customerId: { in: customerIds } }, select: { customerId: true, productId: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const today = dayNum(todayBR());
  const out: RepurchaseRow[] = [];
  for (const r of rows) {
    const p = productById.get(r.product_id);
    const c = customerById.get(r.customer_id);
    if (!p || !c) continue;
    const days = r.days.map(dayNum);
    const last = days[days.length - 1]!;
    // Compras no mesmo fim de semana não contam como intervalo.
    const gaps = days.slice(1).map((d, i) => d - days[i]!).filter((g) => g >= 3);
    let interval: number | null = null;
    let basis: RepurchaseRow['basis'] = 'produto';
    if (gaps.length) {
      interval = median(gaps);
      basis = 'cliente';
    } else if (p.repurchaseDays) interval = p.repurchaseDays;
    if (!interval) continue;
    const due = last + interval;
    const late = today - due;
    if (late < -ahead || late > lateMax) continue;
    const contact = contacts.find((x) => x.customerId === c.id && x.productId === p.id && x.createdAt.getTime() >= last * DAY);
    out.push({
      customerId: c.id,
      customerName: c.name,
      phone: c.phone,
      allowWhatsapp: c.allowWhatsapp,
      isMember: c.isMember,
      cashbackBalance: Number(c.cashbackBalance),
      productId: p.id,
      productName: p.name,
      purchases: days.length,
      lastPurchase: isoOf(last),
      intervalDays: interval,
      basis,
      dueDate: isoOf(due),
      daysLate: late,
      lastContactAt: contact?.createdAt.toISOString() ?? null,
    });
  }
  return out.sort((a, b) => Number(Boolean(a.lastContactAt)) - Number(Boolean(b.lastContactAt)) || b.daysLate - a.daysLate);
}
