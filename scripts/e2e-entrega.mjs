// Teste ponta a ponta da entrega: bairros (taxa, mínimo, grátis acima de),
// endereço da cliente, pedido com pagamento na entrega, taxa na venda (sem
// cashback), despacho, página do entregador por link e troca do link.
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
console.log('Mercearia · Entrega · ponta a ponta');
const owner = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
const storeId = (await db.query(`SELECT s.id FROM store s JOIN tenant t ON t.id = s.tenant_id WHERE t.slug = $1 AND s.active ORDER BY s.created_at LIMIT 1`, [SLUG])).rows[0].id;
const pix = ok(await call('/payment-methods', { token: owner })).find((m) => m.kind === 'pix');
await db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open' AND store_id = $1`, [storeId]);
ok(await call('/cash/open', { token: owner, method: 'POST', body: { storeId, openingAmount: 0 } }), 201);
await db.query(`UPDATE campaign SET active = false WHERE tenant_id = (SELECT id FROM tenant WHERE slug = $1)`, [SLUG]);
ok(await call('/club', { token: owner, method: 'PUT', body: { cashbackPct: 2, cashbackDays: 0, cashbackMaxUsePct: 100, ordersEnabled: true, kitchenFromCounter: true } }));
const item = ok(await call('/products', { token: owner, method: 'POST', body: { name: `Marmita fit ${tag}`, kind: 'revenda', price: 20, cost: 8, trackStock: false, minStock: 0 } }), 201);

let tirol, courier;
await check('configuração: entrega ligada, bairros e entregador', async () => {
  ok(await call('/delivery/settings', { token: owner, method: 'PUT', body: { deliveryEnabled: true, deliveryCity: 'Natal - RN' } }));
  let zones = ok(await call('/delivery/zones', { token: owner, method: 'POST', body: { name: `Tirol ${tag}`, fee: '7,00', minOrder: 30, freeAbove: 100, etaMinutes: 40 } }), 201);
  tirol = zones.find((z) => z.name === `Tirol ${tag}`);
  zones = ok(await call('/delivery/zones', { token: owner, method: 'POST', body: { name: `Longe ${tag}`, fee: 15, active: false } }), 201);
  const dup = await call('/delivery/zones', { token: owner, method: 'POST', body: { name: `Tirol ${tag}`, fee: 1 } });
  assert.equal(code(dup), 'ZONE_TAKEN');
  const couriers = ok(await call('/delivery/couriers', { token: owner, method: 'POST', body: { name: `Zé Moto ${tag}`, phone: '(84) 99999-1234' } }), 201);
  courier = couriers.find((c) => c.name === `Zé Moto ${tag}`);
  assert.match(courier.path, /^\/entregador\/[a-f0-9]{32}$/);
  const info = ok(await call(shop()));
  assert.equal(info.delivery.enabled, true);
  assert.ok(info.delivery.zones.some((z) => z.id === tirol.id && z.fee === 7));
  assert.ok(!info.delivery.zones.some((z) => z.name === `Longe ${tag}`), 'bairro desligado não aparece');
});

const signup = ok(await call(shop('/signup'), { method: 'POST', body: { name: 'Lia Entrega', phone: randomPhone(), pin: '846291', acceptTerms: true } }), 201);
const ctoken = signup.token;
let address;
await check('endereço da cliente só em bairro atendido', async () => {
  const longe = (await db.query(`SELECT id FROM delivery_zone WHERE name = $1`, [`Longe ${tag}`])).rows[0].id;
  const bad = await call(shop('/me/addresses'), { token: ctoken, method: 'POST', body: { street: 'Rua A', number: '1', zoneId: longe } });
  assert.equal(code(bad), 'ZONE_NOT_FOUND');
  const list = ok(await call(shop('/me/addresses'), { token: ctoken, method: 'POST', body: { label: 'Casa', street: 'Av. Afonso Pena', number: '968', complement: 'Apto 201', zoneId: tirol.id, reference: 'Perto da praça' } }), 201);
  address = list[0];
  assert.equal(address.zoneName, `Tirol ${tag}`);
});

let order;
await check('pedido com entrega: mínimo do bairro, taxa e pagamento na entrega', async () => {
  const items = (q) => [{ productId: item.id, quantity: q }];
  const small = await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: items(1), fulfillment: 'entrega', addressId: address.id, payOnDelivery: 'pix' } });
  assert.equal(code(small), 'DELIVERY_MIN_ORDER');
  const noPay = await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: items(2), fulfillment: 'entrega', addressId: address.id } });
  assert.equal(noPay.status, 400);
  order = ok(await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: items(2), fulfillment: 'entrega', addressId: address.id, payOnDelivery: 'dinheiro', changeFor: '50' } }), 201);
  assert.equal(order.fulfillment, 'entrega');
  assert.equal(order.deliveryFee, 7);
  assert.equal(order.estimate, 47);
  assert.equal(order.paymentNote, 'Dinheiro na entrega, troco para R$ 50,00');
  assert.equal(order.address.city, 'Natal - RN');
  const big = ok(await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: items(5), fulfillment: 'entrega', addressId: address.id, payOnDelivery: 'cartao' } }), 201);
  assert.equal(big.deliveryFee, 0, 'grátis acima de R$ 100');
  ok(await call(shop(`/me/orders/${big.id}/cancel`), { token: ctoken, method: 'POST' }), 201);
});

let sale;
await check('caixa registra o pedido: taxa entra no total, mas não gera cashback', async () => {
  const board = ok(await call(`/orders/deliveries?storeId=${storeId}`, { token: owner }));
  assert.ok(board.some((o) => o.id === order.id && o.status === 'aguardando_pagamento'));
  sale = ok(await call('/sales', { token: owner, method: 'POST', body: { storeId, customerId: order.customerId, orderId: order.id, deliveryFee: 0, items: [{ productId: item.id, quantity: 2 }], payments: [{ methodId: pix.id, amount: 47 }] } }), 201);
  assert.equal(sale.deliveryFee, 7, 'a taxa vem do pedido');
  assert.equal(sale.total, 47);
  assert.equal(sale.cashbackEarned, 0.8, '2% de 40, sem a taxa');
  assert.equal(sale.order.status, 'na_fila');
});

await check('despacho: entrega não fecha sem entregador e some do painel de retirada', async () => {
  const early = await call(`/orders/${order.id}/advance`, { token: owner, method: 'POST', body: { status: 'entregue' } });
  assert.equal(code(early), 'ORDER_NOT_DISPATCHED');
  ok(await call(`/orders/${order.id}/advance`, { token: owner, method: 'POST', body: { status: 'pronto' } }), 201);
  const pickup = ok(await call(shop('/pickup')));
  assert.ok(!pickup.ready.some((p) => p.number === order.number && p.callName === 'Lia'), 'entrega não aparece na TV de retirada');
  const sent = ok(await call(`/orders/${order.id}/dispatch`, { token: owner, method: 'POST', body: { courierId: courier.id } }), 201);
  assert.equal(sent.status, 'saiu_entrega');
  assert.equal(sent.courier.name, courier.name);
  assert.equal(ok(await call(shop(`/me/orders/${order.id}`), { token: ctoken })).status, 'saiu_entrega');
});

const token = courier.path.split('/').pop();
await check('entregador pelo link: rota no mapa, valor a cobrar e "entregue"', async () => {
  const run = ok(await call(`/courier/${token}`));
  const o = run.orders.find((x) => x.id === order.id);
  assert.equal(o.toCollect, 47);
  assert.match(o.mapsUrl, /google\.com\/maps\/dir/);
  assert.match(decodeURIComponent(o.mapsUrl), /Afonso Pena, 968 - Tirol .*, Natal - RN/);
  assert.equal(o.paymentNote, 'Dinheiro na entrega, troco para R$ 50,00');
  assert.ok(o.items[0].includes('Marmita fit'));
  const done = ok(await call(`/courier/${token}/orders/${order.id}/delivered`, { method: 'POST' }), 201);
  assert.equal(done.orders.find((x) => x.id === order.id).status, 'entregue');
  assert.equal(code(await call(`/courier/${token}/orders/${order.id}/delivered`, { method: 'POST' })), 'ORDER_STATUS');
  assert.equal(ok(await call(shop(`/me/orders/${order.id}`), { token: ctoken })).status, 'entregue');
  assert.equal((await call('/courier/0123456789abcdef0123456789abcdef')).status, 404);
});

await check('link novo derruba o antigo; entrega desligada recusa pedido', async () => {
  const list = ok(await call(`/delivery/couriers/${courier.id}/rotate`, { token: owner, method: 'POST' }), 201);
  const fresh = list.find((c) => c.id === courier.id).path.split('/').pop();
  assert.notEqual(fresh, token);
  assert.equal((await call(`/courier/${token}`)).status, 404);
  ok(await call(`/courier/${fresh}`));
  ok(await call('/delivery/settings', { token: owner, method: 'PUT', body: { deliveryEnabled: false, deliveryCity: 'Natal - RN' } }));
  const off = await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: [{ productId: item.id, quantity: 2 }], fulfillment: 'entrega', addressId: address.id, payOnDelivery: 'pix' } });
  assert.equal(code(off), 'DELIVERY_OFF');
  assert.equal(ok(await call(shop())).delivery.enabled, false);
});

await db.end();
console.log(`\n${passed} verificações ok`);
