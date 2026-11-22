// Teste ponta a ponta do iFood (com o simulador, IFOOD_PROVIDER=teste): pedido novo vira pedido na tela de preparo e
// venda no canal iFood; item sem código fica "sem cadastro" e é refeito; caixa fechado; andamento avisado; cancelamento.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const pg = require('pg');
const BASE = (process.env.E2E_BASE ?? 'http://localhost:3000') + '/v1';
const SLUG = process.env.E2E_SLUG ?? 'mercearia-saudavel';
const DB = process.env.E2E_DATABASE_URL;
const OWNER = { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
if (!OWNER.email || !OWNER.password || !DB) {
  console.error('Defina E2E_EMAIL, E2E_PASSWORD e E2E_DATABASE_URL');
  process.exit(2);
}
const tag = Date.now().toString(36);
let passed = 0;
async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
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

const db = new pg.Client({ connectionString: DB });
await db.connect();
console.log('iFood: pedidos, venda, andamento e cancelamento');
const token = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
const T = { token };
const storeId = (await db.query(`SELECT s.id FROM store s JOIN tenant t ON t.id = s.tenant_id WHERE t.slug = $1 AND s.active ORDER BY s.created_at LIMIT 1`, [SLUG])).rows[0].id;
await db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open' AND store_id = $1`, [storeId]);
ok(await call('/cash/open', { ...T, method: 'POST', body: { storeId, openingAmount: 0 } }), 201);
const produto = ok(await call('/products', { ...T, method: 'POST', body: { name: `Barra iFood ${tag}`, kind: 'revenda', sku: `IF${tag}`, price: '12,00', cost: '5,00', trackStock: true } }), 201);
ok(await call(`/products/${produto.id}/stock`, { ...T, method: 'POST', body: { type: 'entrada', storeId, quantity: 10 } }), 201);
const saldo = async () => Number((await db.query(`SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_balance WHERE product_id = $1`, [produto.id])).rows[0].q);
const pedido = (n, itens, extra = {}) => ({ id: `ifood-${tag}-${n}`, displayId: `${n}${tag.slice(-3)}`.toUpperCase(), orderType: 'TAKEOUT', customer: { name: 'Marina Souza' }, items: itens, total: { subTotal: 26, deliveryFee: 0, orderAmount: 26 }, ...extra });
const simular = async (body) => ok(await call('/ifood/test', { ...T, method: 'POST', body }), 201);
const linha = async (n) => ok(await call('/ifood', T)).orders.find((o) => o.displayId === `${n}${tag.slice(-3)}`.toUpperCase());

await check('pedido novo é aceito no iFood, entra na tela de preparo e vira venda no canal iFood com baixa de estoque', async () => {
  const r = await simular({ order: pedido(1, [{ name: 'Barra', quantity: 2, externalCode: `IF${tag}`, observations: 'sem canudo' }]) });
  assert.ok(r.actions.some((a) => a.id === `ifood-${tag}-1` && a.action === 'confirm'));
  const l = await linha(1);
  assert.deepEqual([l.status, l.total, l.localTotal, l.orderStatus, l.problem], ['importado', 26, 24, 'na_fila', null]);
  assert.ok(l.saleNumber > 0);
  const v = (await db.query(`SELECT s.channel, s.total::float, pm.name FROM sale s JOIN cash_movement m ON m.sale_id = s.id JOIN payment_method pm ON pm.id = m.method_id WHERE s.number = $1 AND s.store_id = $2`, [l.saleNumber, storeId])).rows[0];
  assert.deepEqual([v.channel, v.total, v.name], ['ifood', 24, 'iFood']);
  assert.equal(await saldo(), 8);
  const o = (await db.query(`SELECT channel, notes, call_name FROM "order" WHERE number = $1 AND store_id = $2 ORDER BY created_at DESC LIMIT 1`, [l.orderNumber, storeId])).rows[0];
  assert.equal(o.channel, 'ifood');
  assert.match(o.notes, /sem canudo/);
  // O mesmo evento de novo não duplica.
  await simular({ order: pedido(1, [{ name: 'Barra', quantity: 2, externalCode: `IF${tag}` }]) });
  assert.equal(await saldo(), 8);
});
await check('andar na tela de preparo avisa o iFood (em preparo, pronto)', async () => {
  const l = await linha(1);
  const o = (await db.query(`SELECT id FROM "order" WHERE number = $1 AND store_id = $2 ORDER BY created_at DESC LIMIT 1`, [l.orderNumber, storeId])).rows[0];
  ok(await call(`/orders/${o.id}/advance`, { ...T, method: 'POST', body: { status: 'preparando' } }));
  let r = await simular({});
  assert.ok(r.actions.some((a) => a.id === `ifood-${tag}-1` && a.action === 'startPreparation'));
  ok(await call(`/orders/${o.id}/advance`, { ...T, method: 'POST', body: { status: 'pronto' } }));
  r = await simular({});
  assert.equal(r.actions.filter((a) => a.id === `ifood-${tag}-1` && a.action === 'readyToPickup').length, 1);
  r = await simular({});
  assert.equal(r.actions.filter((a) => a.id === `ifood-${tag}-1`).length, 3, 'não repete o aviso');
});
await check('item sem código PDV fica "sem cadastro"; corrigido o código, "tentar de novo" registra', async () => {
  await simular({ order: pedido(2, [{ name: 'Barra', quantity: 1, externalCode: `NOVO${tag}` }]) });
  let l = await linha(2);
  assert.deepEqual([l.status, l.items[0].matched, l.orderNumber], ['sem_cadastro', false, null]);
  assert.match(l.problem, /código PDV/);
  await db.query(`UPDATE product SET barcode = $1 WHERE id = $2`, [`NOVO${tag}`, produto.id]);
  ok(await call(`/ifood/orders/${l.id}/retry`, { ...T, method: 'POST' }), 201);
  l = await linha(2);
  assert.deepEqual([l.status, l.orderStatus, l.localTotal], ['importado', 'na_fila', 12]);
  assert.equal(await saldo(), 7);
});
await check('caixa fechado: o pedido espera e a venda entra sozinha quando o caixa abre', async () => {
  await db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open' AND store_id = $1`, [storeId]);
  await simular({ order: pedido(3, [{ name: 'Barra', quantity: 1, externalCode: `IF${tag}` }]) });
  let l = await linha(3);
  assert.deepEqual([l.status, l.orderStatus, l.saleNumber], ['importado', 'aguardando_pagamento', null]);
  assert.match(l.problem, /Caixa fechado/);
  assert.equal(await saldo(), 7);
  ok(await call('/cash/open', { ...T, method: 'POST', body: { storeId, openingAmount: 0 } }), 201);
  await simular({});
  l = await linha(3);
  assert.deepEqual([l.orderStatus, l.problem], ['na_fila', null]);
  assert.equal(await saldo(), 6);
});
await check('cancelado no iFood: o pedido é cancelado aqui e a tela pede para cancelar a venda', async () => {
  await simular({ cancel: `ifood-${tag}-3` });
  const l = await linha(3);
  assert.deepEqual([l.status, l.orderStatus], ['cancelado', 'cancelado']);
  assert.match(l.problem, /cancele a venda nº/);
});
await check('a tela só abre para quem trabalha com pedidos e o simulador não aceita anônimo', async () => {
  ok(await call('/ifood'), 401);
  ok(await call('/ifood/test', { method: 'POST', body: {} }), 401);
});

await db.end();
console.log(`\n${passed} verificações do iFood passaram.`);
