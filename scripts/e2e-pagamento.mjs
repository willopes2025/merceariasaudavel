// Teste ponta a ponta do pagamento online com o provedor de teste
// (rode a API com PAY_PROVIDER=teste): Pix e cartão no app, Pix no totem,
// venda registrada sozinha, caixa fechado (o caixa registra depois), valor
// diferente, Pix que cai depois do pedido cancelado (devolvido) e venda
// cancelada (devolvida).
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
const tag = Date.now().toString(36);
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

const db = new pg.Client({ connectionString: DB });
await db.connect();
console.log('Mercearia · Pagamento online · ponta a ponta');
const owner = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
const storeId = (await db.query(`SELECT s.id FROM store s JOIN tenant t ON t.id = s.tenant_id WHERE t.slug = $1 AND s.active ORDER BY s.created_at LIMIT 1`, [SLUG])).rows[0].id;
const pix = ok(await call('/payment-methods', { token: owner })).find((m) => m.kind === 'pix' && !m.name.includes('online'));
const closeCash = () => db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open' AND store_id = $1`, [storeId]);
const openCash = async () => {
  await closeCash();
  ok(await call('/cash/open', { token: owner, method: 'POST', body: { storeId, openingAmount: 0 } }), 201);
};
await openCash();
await db.query(`UPDATE campaign SET active = false WHERE tenant_id = (SELECT id FROM tenant WHERE slug = $1)`, [SLUG]);
ok(await call('/club', { token: owner, method: 'PUT', body: { cashbackPct: 5, cashbackDays: 0, cashbackMaxUsePct: 100, ordersEnabled: true, kitchenFromCounter: true } }));
const item = ok(await call('/products', { token: owner, method: 'POST', body: { name: `Açaí online ${tag}`, kind: 'revenda', price: 25, cost: 10, trackStock: false, minStock: 0 } }), 201);
const items = (q = 2) => [{ productId: item.id, quantity: q }];
const signup = ok(await call(shop('/signup'), { method: 'POST', body: { name: 'Nina Online', phone: randomPhone(), pin: '846291', acceptTerms: true } }), 201);
const ctoken = signup.token;
const newOrder = async (body = {}) => ok(await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: items(), ...body } }), 201);
const pay = (id, method) => call(shop(`/me/orders/${id}/pay`), { token: ctoken, method: 'POST', body: { method } });
const approve = (id, amount) => call(`/payments/test/orders/${id}/approve`, { token: owner, method: 'POST', body: amount === undefined ? {} : { amount } });
const getOrder = async (id) => ok(await call(`/orders/${id}`, { token: owner }));

await check('configuração: provedor de teste, liga Pix e cartão; app enxerga', async () => {
  ok(await call('/payments/settings', { token: owner, method: 'PUT', body: { onlinePix: false, onlineCard: false, onlineTotem: false } }));
  const off = await newOrder({ payOnline: 'pix' }).catch((e) => e);
  assert.match(String(off.message), /ONLINE_PAY_OFF/);
  const s = ok(await call('/payments/settings', { token: owner, method: 'PUT', body: { onlinePix: true, onlineCard: true, onlineTotem: false } }));
  assert.equal(s.provider, 'teste');
  assert.equal(s.testMode, true);
  const info = ok(await call(shop()));
  assert.deepEqual(info.online, { pix: true, card: true, totem: false });
});

let paidOrder;
await check('Pix no app: QR, reaproveita o mesmo Pix, pago vira venda e entra na fila', async () => {
  const o = await newOrder({ payOnline: 'pix' });
  assert.equal(o.payOnline, 'pix');
  const p1 = ok(await pay(o.id, 'pix'), 201);
  assert.equal(p1.status, 'pendente');
  assert.equal(p1.amount, 50);
  assert.ok(p1.qrCode.startsWith('000201'));
  assert.equal(p1.test, true);
  const p2 = ok(await pay(o.id, 'pix'), 201);
  assert.equal(p2.id, p1.id, 'mesmo Pix enquanto não vence');
  assert.equal(ok(await call(shop(`/me/orders/${o.id}/pay`), { token: ctoken })).status, 'pendente');
  const done = ok(await approve(o.id), 201);
  assert.equal(done.status, 'na_fila');
  assert.ok(done.saleId);
  assert.equal(done.online.status, 'pago');
  const view = ok(await call(shop(`/me/orders/${o.id}/pay`), { token: ctoken }));
  assert.equal(view.status, 'pago');
  assert.equal(view.qrCode, null);
  const sale = ok(await call(`/sales/${done.saleId}`, { token: owner }));
  assert.equal(sale.total, 50);
  assert.equal(sale.channel, 'app');
  assert.equal(sale.cashbackEarned, 2.5);
  const methods = (await db.query(`SELECT pm.name FROM cash_movement cm JOIN payment_method pm ON pm.id = cm.method_id WHERE cm.sale_id = $1`, [done.saleId])).rows.map((r) => r.name);
  assert.deepEqual(methods, ['Pix online']);
  paidOrder = done;
});

await check('cartão no app: checkout volta para o pedido; aprovado entra na fila', async () => {
  const o = await newOrder({ payOnline: 'cartao' });
  const p = ok(await pay(o.id, 'cartao'), 201);
  assert.ok(p.checkoutUrl.includes(`/app/pedido/${o.id}`));
  assert.equal(p.qrCode, null);
  const done = ok(await approve(o.id), 201);
  assert.equal(done.status, 'na_fila');
  const methods = (await db.query(`SELECT pm.name, pm.kind FROM cash_movement cm JOIN payment_method pm ON pm.id = cm.method_id WHERE cm.sale_id = $1`, [done.saleId])).rows;
  assert.deepEqual(methods, [{ name: 'Cartão online', kind: 'credito' }]);
});

await check('caixa fechado: não gera Pix; pago com caixa fechado fica para o caixa registrar', async () => {
  const o = await newOrder({ payOnline: 'pix' });
  await closeCash();
  assert.equal(code(await pay(o.id, 'pix')), 'STORE_CLOSED');
  await openCash();
  ok(await pay(o.id, 'pix'), 201);
  await closeCash();
  const pending = ok(await approve(o.id), 201);
  assert.equal(pending.status, 'aguardando_pagamento');
  assert.equal(pending.online.status, 'pago');
  assert.match(pending.online.settleError, /Caixa fechado/);
  await openCash();
  const double = await call('/sales', { token: owner, method: 'POST', body: { storeId, orderId: o.id, items: items(), channel: 'app', payments: [{ methodId: pix.id, amount: 50 }] } });
  assert.equal(code(double), 'ORDER_PAID_ONLINE', 'o caixa não cobra de novo');
  assert.equal(code(await call(shop(`/me/orders/${o.id}/cancel`), { token: ctoken, method: 'POST' })), 'ORDER_PAID');
  const settled = ok(await call(`/orders/${o.id}/settle-online`, { token: owner, method: 'POST' }), 201);
  assert.equal(settled.status, 'na_fila');
  assert.equal(settled.online.settleError, null);
});

await check('valor diferente: não vira venda; cancelar o pedido devolve o dinheiro', async () => {
  const o = await newOrder({ payOnline: 'pix' });
  ok(await pay(o.id, 'pix'), 201);
  const odd = ok(await approve(o.id, 1), 201);
  assert.equal(odd.status, 'aguardando_pagamento');
  assert.equal(odd.online.status, 'divergente');
  const canceled = ok(await call(`/orders/${o.id}/cancel`, { token: owner, method: 'POST', body: { reason: 'Valor errado' } }), 201);
  assert.equal(canceled.status, 'cancelado');
  assert.equal(canceled.online.status, 'estornado');
});

await check('cobrado no caixa com Pix aberto: Pix cancelado; se cair depois, é devolvido', async () => {
  const o = await newOrder({ payOnline: 'pix' });
  ok(await pay(o.id, 'pix'), 201);
  ok(await call('/sales', { token: owner, method: 'POST', body: { storeId, orderId: o.id, items: items(), channel: 'app', payments: [{ methodId: pix.id, amount: 50 }] } }), 201);
  assert.equal((await getOrder(o.id)).online.status, 'cancelado');
  const late = ok(await approve(o.id), 201);
  assert.equal(late.online.status, 'estornado');
  assert.equal(late.status, 'na_fila', 'continua com a venda do caixa');
});

await check('cancelar venda paga online devolve o pagamento', async () => {
  ok(await call(`/sales/${paidOrder.saleId}/cancel`, { token: owner, method: 'POST', body: { reason: 'Cliente desistiu' } }), 201);
  const o = await getOrder(paidOrder.id);
  assert.equal(o.status, 'cancelado');
  assert.equal(o.online.status, 'estornado');
});

await check('Pix no totem: só com o totem ligado; pago entra na fila', async () => {
  const t = ok(await call(shop('/totem/orders'), { method: 'POST', body: { items: items(1), callName: 'Rafa' } }), 201);
  assert.equal(code(await call(shop(`/totem/orders/${t.id}/pay`), { method: 'POST' })), 'ONLINE_PAY_OFF');
  ok(await call('/payments/settings', { token: owner, method: 'PUT', body: { onlinePix: true, onlineCard: true, onlineTotem: true } }));
  const p = ok(await call(shop(`/totem/orders/${t.id}/pay`), { method: 'POST' }), 201);
  assert.equal(p.method, 'pix');
  assert.equal(p.amount, 25);
  ok(await approve(t.id), 201);
  assert.equal(ok(await call(shop(`/totem/orders/${t.id}/pay`))).status, 'pago');
  const o = await getOrder(t.id);
  assert.equal(o.status, 'na_fila');
  assert.equal(ok(await call(`/sales/${o.saleId}`, { token: owner })).channel, 'loja');
});

await check('pedido de outra cliente não abre pagamento; aviso falso do provedor é ignorado', async () => {
  const other = ok(await call(shop('/signup'), { method: 'POST', body: { name: 'Outra Pessoa', phone: randomPhone(), pin: '846291', acceptTerms: true } }), 201);
  const o = await newOrder({ payOnline: 'pix' });
  assert.equal((await call(shop(`/me/orders/${o.id}/pay`), { token: other.token, method: 'POST', body: { method: 'pix' } })).status, 404);
  const hook = await call('/payments/webhook/mercadopago?type=payment&data.id=123', { method: 'POST', body: { type: 'payment', data: { id: '123' } } });
  assert.equal(hook.status, 200);
  assert.equal((await getOrder(o.id)).status, 'aguardando_pagamento');
  ok(await call(shop(`/me/orders/${o.id}/cancel`), { token: ctoken, method: 'POST' }), 201);
});

ok(await call('/payments/settings', { token: owner, method: 'PUT', body: { onlinePix: false, onlineCard: false, onlineTotem: false } }));
await db.end();
console.log(`\n${passed} verificações passaram.`);
