// Teste ponta a ponta de parceiros e kits: código do parceiro (desconto e
// comissão), cliente ligada pelo link de indicação ou pelo código no caixa,
// cupom de campanha não acumula, portal do parceiro, fechamento do mês virando
// conta a pagar, kits no app e código no pedido do app.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const pg = require('pg');
const BASE = (process.env.E2E_BASE ?? 'http://localhost:3000') + '/v1';
const DB = process.env.E2E_DATABASE_URL;
const SLUG = process.env.E2E_SLUG ?? 'mercearia-saudavel';
const OWNER = { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
if (!DB || !OWNER.email || !OWNER.password) {
  console.error('Defina E2E_DATABASE_URL, E2E_EMAIL e E2E_PASSWORD');
  process.exit(2);
}
const tag = Date.now().toString(36).toUpperCase();
let passed = 0;
async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const ok = (r, status) => {
  if (status) assert.equal(r.status, status, JSON.stringify(r.body));
  else assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const code = (r) => r.body?.error?.code;
const shop = (p = '') => `/shop/${SLUG}${p}`;
const randomPhone = () => `279${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const brMonth = (offset = 0) => {
  const d = new Date(Date.now() - 3 * 3600e3);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
};

const db = new pg.Client({ connectionString: DB });
await db.connect();
console.log('Mercearia · Parceiros e kits · ponta a ponta');
const owner = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
const storeId = (await db.query(`SELECT s.id FROM store s JOIN tenant t ON t.id = s.tenant_id WHERE t.slug = $1 AND s.active ORDER BY s.created_at LIMIT 1`, [SLUG])).rows[0].id;
const pix = ok(await call('/payment-methods', { token: owner })).find((m) => m.kind === 'pix');
await db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open' AND store_id = $1`, [storeId]);
ok(await call('/cash/open', { token: owner, method: 'POST', body: { storeId, openingAmount: 0 } }), 201);
await db.query(`UPDATE campaign SET active = false WHERE tenant_id = (SELECT id FROM tenant WHERE slug = $1)`, [SLUG]);
ok(await call('/club', { token: owner, method: 'PUT', body: { cashbackPct: 0, cashbackDays: 0, cashbackMaxUsePct: 100, ordersEnabled: true, kitchenFromCounter: false } }));
const product = async (body) => ok(await call('/products', { token: owner, method: 'POST', body: { kind: 'revenda', cost: 10, trackStock: false, minStock: 0, ...body } }), 201);
const whey = await product({ name: `Whey parceiro ${tag}`, price: 100 });
const bar = await product({ name: `Barra parceiro ${tag}`, price: 10 });
const insumo = await product({ name: `Insumo parceiro ${tag}`, kind: 'insumo', price: 0, sellable: true });
const quote = (body) => call('/sales/quote', { token: owner, method: 'POST', body: { storeId, ...body } });
const sell = (body, total) => call('/sales', { token: owner, method: 'POST', body: { storeId, payments: [{ methodId: pix.id, amount: total }], ...body } });
const CODE = `NUTRI${tag}`.slice(0, 20);

let partner, ana, anaToken;
await check('parceiro: cadastro, código único e validação', async () => {
  partner = ok(await call('/partners', { token: owner, method: 'POST', body: { name: 'Ana Nutri', kind: 'nutricionista', code: CODE.toLowerCase(), customerDiscountPct: '10', commissionPct: '15', phone: '(84) 99999-1234' } }), 201);
  assert.equal(partner.code, CODE);
  assert.match(partner.path, /^\/parceiro\/[a-f0-9]{32}$/);
  assert.equal(code(await call('/partners', { token: owner, method: 'POST', body: { name: 'Outra', code: CODE, commissionPct: 5 } })), 'PARTNER_CODE_TAKEN');
  assert.equal((await call('/partners', { token: owner, method: 'POST', body: { name: 'Ruim', code: 'a b', commissionPct: 5 } })).status, 400);
});

await check('cadastro pelo link de indicação liga a cliente ao parceiro', async () => {
  const r = ok(await call(shop('/signup'), { method: 'POST', body: { name: 'Bia Indicada', phone: randomPhone(), pin: '739215', acceptTerms: true, partnerCode: CODE.toLowerCase() } }), 201);
  anaToken = r.token;
  const me = ok(await call(shop('/me'), { token: anaToken }));
  ana = me;
  assert.equal(me.partner?.name, 'Ana Nutri');
  assert.equal(me.partner?.discountPct, 10);
  const bad = ok(await call(shop('/signup'), { method: 'POST', body: { name: 'Sem Parceiro', phone: randomPhone(), pin: '739215', acceptTerms: true, partnerCode: 'NAOEXISTE' } }), 201);
  assert.equal(ok(await call(shop('/me'), { token: bad.token })).partner, null, 'código inexistente não trava o cadastro');
});

await check('cliente ligada: desconto do parceiro e comissão sobre o que pagou', async () => {
  const q = ok(await quote({ customerId: ana.id, items: [{ productId: whey.id, quantity: 1 }] }));
  assert.equal(q.partner.name, 'Ana Nutri');
  assert.equal(q.partner.discount, 10);
  assert.equal(q.partner.commission, 13.5);
  assert.equal(q.total, 90);
  const sale = ok(await sell({ customerId: ana.id, items: [{ productId: whey.id, quantity: 1 }] }, 90), 201);
  assert.equal(sale.partnerName, 'Ana Nutri');
  assert.equal(sale.partnerDiscount, 10);
  assert.equal(sale.partnerCommission, 13.5);
  assert.equal(sale.discount, 10);
});

await check('código digitado no caixa: desconto, comissão e liga a cliente', async () => {
  const other = ok(await call(shop('/signup'), { method: 'POST', body: { name: 'Carla Balcão', phone: randomPhone(), pin: '739215', acceptTerms: true } }), 201);
  const me = ok(await call(shop('/me'), { token: other.token }));
  assert.equal(me.partner, null);
  const sale = ok(await sell({ customerId: me.id, couponCode: CODE, items: [{ productId: bar.id, quantity: 2 }] }, 18), 201);
  assert.equal(sale.partnerDiscount, 2);
  assert.equal(sale.partnerCommission, 2.7);
  assert.equal(ok(await call(shop('/me'), { token: other.token })).partner?.name, 'Ana Nutri');
  const anon = ok(await sell({ couponCode: CODE, items: [{ productId: bar.id, quantity: 1 }] }, 9), 201);
  assert.equal(anon.partnerCommission, 1.35);
  const wrong = await quote({ couponCode: 'NAOEXISTE9', items: [{ productId: bar.id, quantity: 1 }] });
  assert.ok(ok(wrong).couponError);
});

await check('cupom de campanha não acumula com o desconto do parceiro (comissão continua)', async () => {
  ok(await call('/campaigns', { token: owner, method: 'POST', body: { name: `Cupom ${tag}`, type: 'cupom', active: true, startsOn: brMonth().concat('-01'), endsOn: '2099-12-31', weekdays: [], audience: 'todos', code: `C${tag}`.slice(0, 20), discountPct: 20, minPurchase: 0, maxPerCustomer: null, scope: 'tudo', categoryIds: [], products: [] } }), 201);
  const q = ok(await quote({ customerId: ana.id, couponCode: `C${tag}`.slice(0, 20), items: [{ productId: whey.id, quantity: 1 }] }));
  assert.equal(q.coupon.discount, 20);
  assert.equal(q.partner.discount, 0);
  assert.equal(q.partner.commission, 12);
  await db.query(`UPDATE campaign SET active = false WHERE code = $1`, [`C${tag}`.slice(0, 20)]);
  assert.equal(code(await call('/partners', { token: owner, method: 'POST', body: { name: 'Choque', code: `C${tag}`.slice(0, 20), commissionPct: 5 } })), 'PARTNER_CODE_TAKEN');
});

await check('lista do mês: clientes, vendas, vendido e comissão', async () => {
  const p = ok(await call(`/partners?month=${brMonth()}`, { token: owner })).find((x) => x.id === partner.id);
  assert.equal(p.stats.customers, 2);
  assert.equal(p.stats.newCustomers, 2);
  assert.equal(p.stats.sales, 3);
  assert.equal(p.stats.revenue, 117);
  assert.equal(p.stats.commission, 17.55);
  assert.equal(p.stats.closed, false);
});

await check('portal do parceiro pelo link (só primeiro nome) e link inválido', async () => {
  const token = partner.path.split('/').pop();
  const portal = ok(await call(`/partner-portal/${token}`));
  assert.equal(portal.code, CODE);
  assert.equal(portal.months.length, 6);
  assert.equal(portal.months[0].commission, 17.55);
  assert.deepEqual(portal.customers.map((c) => c.firstName).sort(), ['Bia', 'Carla']);
  assert.ok(portal.signupPath.includes(`ref=${CODE}`));
  assert.equal((await call(`/partner-portal/${'0'.repeat(32)}`)).status, 404);
  const rotated = ok(await call(`/partners/${partner.id}/rotate`, { token: owner, method: 'POST' })).find((x) => x.id === partner.id);
  assert.equal((await call(`/partner-portal/${token}`)).status, 404, 'link antigo para de funcionar');
  partner = rotated;
});

await check('fechamento do mês: só mês encerrado, vira conta a pagar, uma vez só', async () => {
  assert.equal(code(await call(`/partners/${partner.id}/close`, { token: owner, method: 'POST', body: { month: brMonth(), dueDate: '2099-01-10' } })), 'MONTH_OPEN');
  await db.query(`UPDATE sale SET created_at = created_at - interval '35 days' WHERE partner_id = $1`, [partner.id]);
  const last = brMonth(-1);
  const p = ok(await call(`/partners/${partner.id}/close`, { token: owner, method: 'POST', body: { month: last, dueDate: '2099-01-10' } }), 201);
  assert.equal(p.stats.closed, true);
  assert.equal(p.stats.commission, 17.55);
  const pay = (await db.query(`SELECT amount, category, supplier FROM payable WHERE id = (SELECT payable_id FROM partner_payout WHERE partner_id = $1 AND month = $2)`, [partner.id, last])).rows[0];
  assert.equal(Number(pay.amount), 17.55);
  assert.equal(pay.category, 'folha');
  assert.equal(pay.supplier, 'Ana Nutri');
  assert.equal(code(await call(`/partners/${partner.id}/close`, { token: owner, method: 'POST', body: { month: last, dueDate: '2099-01-10' } })), 'MONTH_CLOSED');
});

await check('kits: validação, total de membro e aparece no app', async () => {
  assert.equal((await call('/kits', { token: owner, method: 'POST', body: { name: 'Kit curto', items: [{ productId: whey.id, quantity: 1 }] } })).status, 400);
  assert.equal(code(await call('/kits', { token: owner, method: 'POST', body: { name: 'Kit insumo', items: [{ productId: whey.id, quantity: 1 }, { productId: insumo.id, quantity: 1 }] } })), 'PRODUCT_NOT_SELLABLE');
  const kits = ok(await call('/kits', { token: owner, method: 'POST', body: { name: `Kit Massa ${tag}`, goal: 'massa', partnerId: partner.id, items: [{ productId: whey.id, quantity: 1 }, { productId: bar.id, quantity: '3' }] } }), 201);
  const k = kits.find((x) => x.name === `Kit Massa ${tag}`);
  assert.equal(k.total, 130);
  assert.equal(k.partnerName, 'Ana Nutri');
  const inApp = ok(await call(shop('/kits'))).find((x) => x.id === k.id);
  assert.ok(inApp, 'kit no app');
  assert.equal(inApp.items.length, 2);
  assert.equal(inApp.partnerName, 'Ana Nutri');
  const portal = ok(await call(`/partner-portal/${partner.path.split('/').pop()}`));
  assert.ok(portal.kits.some((x) => x.id === k.id && x.path.includes(`kit=${k.id}`)));
});

await check('pedido do app com código: guarda o código e recusa código errado', async () => {
  const bad = await call(shop('/me/orders'), { token: anaToken, method: 'POST', body: { items: [{ productId: bar.id, quantity: 1 }], couponCode: 'NAOEXISTE9' } });
  assert.equal(code(bad), 'COUPON_INVALID');
  const order = ok(await call(shop('/me/orders'), { token: anaToken, method: 'POST', body: { items: [{ productId: bar.id, quantity: 1 }], couponCode: CODE } }), 201);
  assert.equal(order.couponCode, CODE);
  ok(await call(shop(`/me/orders/${order.id}/cancel`), { token: anaToken, method: 'POST' }));
});

await db.end();
console.log(`\n${passed} verificações passaram.`);
