// Teste ponta a ponta da inteligência de estoque e compras: fornecedor,
// cobertura e ponto de pedido, múltiplo de compra, falta, parado, risco de
// vencer, curva ABC e pedido de compra (enviado conta como "já pedido";
// recebido dá entrada no estoque).
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
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const todayBR = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const db = new pg.Client({ connectionString: DB });
await db.connect();
console.log('Mercearia · Inteligência de estoque e compras · ponta a ponta');
const owner = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
// Loja própria do teste: a análise fica só com os produtos daqui.
const storeId = ok(await call('/stores', { token: owner, method: 'POST', body: { name: `Loja estoque ${tag}`, code: `e${tag}`.slice(0, 12) } }), 201).id;
const pix = ok(await call('/payment-methods', { token: owner })).find((m) => m.kind === 'pix');
ok(await call('/cash/open', { token: owner, method: 'POST', body: { storeId, openingAmount: 0 } }), 201);
await db.query(`UPDATE campaign SET active = false WHERE tenant_id = (SELECT id FROM tenant WHERE slug = $1)`, [SLUG]);
const intel = async (qs = '') => ok(await call(`/stock/intelligence?storeId=${storeId}&days=60${qs}`, { token: owner }));
const row = (data, id) => data.rows.find((r) => r.productId === id);
const product = async (body) => ok(await call('/products', { token: owner, method: 'POST', body: { trackStock: true, cost: 10, minStock: 0, kind: 'revenda', price: 20, ...body } }), 201);
const entry = (id, quantity, extra = {}) => call(`/products/${id}/stock`, { token: owner, method: 'POST', body: { type: 'entrada', storeId, quantity, ...extra } });
const sell = (id, quantity, price) => call('/sales', { token: owner, method: 'POST', body: { storeId, items: [{ productId: id, quantity }], payments: [{ methodId: pix.id, amount: Math.round(quantity * price * 100) / 100 }] } });

let supplier;
await check('fornecedor com prazo de entrega e WhatsApp', async () => {
  const doc = String(Date.now()).slice(-14).padStart(14, '1');
  supplier = ok(await call('/suppliers', { token: owner, method: 'POST', body: { name: `Distribuidora ${tag}`, document: doc, phone: '(27) 99888-7766', leadTimeDays: 5, minOrder: '300' } }), 201);
  assert.equal(supplier.phone, '5527998887766');
  assert.equal(supplier.leadTimeDays, 5);
  const dup = await call('/suppliers', { token: owner, method: 'POST', body: { name: 'Outra', document: doc } });
  assert.equal(code(dup), 'SUPPLIER_DOCUMENT_TAKEN');
});

let a, idle, gone, lot;
await check('cobertura, ponto de pedido e compra arredondada ao múltiplo', async () => {
  a = await product({ name: `Granola ${tag}`, minStock: 2, supplierId: supplier.id, packSize: 6 });
  assert.equal(a.supplierName, supplier.name);
  ok(await entry(a.id, 40));
  ok(await sell(a.id, 30, 20), 201);
  let r = row(await intel(), a.id);
  near(r.dailyUse, 0.5);
  near(r.coverDays, 20);
  assert.equal(r.suggested, 0, 'acima do ponto de pedido');
  assert.equal(r.status, 'ok');
  ok(await sell(a.id, 5, 20), 201);
  r = row(await intel(), a.id);
  // 35/60 por dia; prazo 5 + 21 dias + mínimo 2 = 17,17; tem 5 → 12,17 → caixa de 6 → 18.
  assert.equal(r.suggested, 18);
  assert.equal(r.suggestedCost, 180);
  assert.equal(r.status, 'atencao');
  assert.equal(r.leadTimeDays, 5);
});

await check('parado, em falta e dinheiro parado', async () => {
  idle = await product({ name: `Parado ${tag}` });
  ok(await entry(idle.id, 5));
  gone = await product({ name: `Em falta ${tag}`, minStock: 3 });
  const data = await intel();
  assert.equal(row(data, idle.id).status, 'parado');
  assert.equal(row(data, gone.id).status, 'ruptura');
  assert.equal(row(data, gone.id).suggested, 3, 'repõe o mínimo');
  assert.ok(data.totals.idleValue >= 50);
  assert.ok(data.totals.missing >= 1);
});

await check('risco de vencer: lote que o ritmo de venda não dá conta', async () => {
  lot = await product({ name: `Iogurte ${tag}`, trackLots: true, price: 10, cost: 5 });
  ok(await entry(lot.id, 12, { lotCode: 'L1', expiresAt: addDays(todayBR, 10) }));
  ok(await sell(lot.id, 6, 10), 201);
  const r = row(await intel(), lot.id);
  // 6 em 60 dias = 0,1/dia; em 10 dias vende 1; dos 6 que sobram, 5 vencem.
  near(r.expiryRisk.quantity, 5);
  near(r.expiryRisk.value, 25);
  assert.equal(r.expiryRisk.firstDate, addDays(todayBR, 10));
});

await check('curva ABC pelo faturamento', async () => {
  const data = await intel();
  assert.equal(row(data, a.id).abc, 'A');
  assert.equal(row(data, lot.id).abc, 'B');
  assert.equal(row(data, idle.id).abc, 'C');
  assert.ok(row(data, a.id).margin > 0);
});

let po;
await check('pedido de compra: enviado conta como já pedido; recebido dá entrada', async () => {
  po = ok(await call('/purchase-orders', { token: owner, method: 'POST', body: { storeId, supplierId: supplier.id, items: [{ productId: a.id, quantity: 18, unitCost: '9,50' }], expectedOn: addDays(todayBR, 5) } }), 201);
  assert.equal(po.status, 'rascunho');
  assert.equal(po.total, 171);
  assert.equal(row(await intel(), a.id).suggested, 18, 'rascunho ainda não conta');
  ok(await call(`/purchase-orders/${po.id}/status`, { token: owner, method: 'POST', body: { status: 'enviado' } }), 201);
  const sent = row(await intel(), a.id);
  assert.equal(sent.onOrder, 18);
  assert.equal(sent.suggested, 0);
  const edit = await call(`/purchase-orders/${po.id}`, { token: owner, method: 'PUT', body: { storeId, supplierId: supplier.id, items: [{ productId: a.id, quantity: 1 }] } });
  assert.equal(code(edit), 'PURCHASE_NOT_DRAFT');
  const done = ok(await call(`/purchase-orders/${po.id}/status`, { token: owner, method: 'POST', body: { status: 'recebido', addStock: true } }), 201);
  assert.ok(done.receivedAt);
  const after = row(await intel(), a.id);
  assert.equal(after.stock, 23);
  assert.equal(after.onOrder, 0);
  const detail = ok(await call(`/products/${a.id}`, { token: owner }));
  assert.equal(detail.cost, 9.5, 'custo da última compra');
  const back = await call(`/purchase-orders/${po.id}/status`, { token: owner, method: 'POST', body: { status: 'cancelado' } });
  assert.equal(code(back), 'PURCHASE_STATUS');
});

await check('atendente vê a análise mas não faz pedido de compra', async () => {
  const email = `atend-est-${tag}@teste.local`;
  ok(await call('/users', { token: owner, method: 'POST', body: { name: 'Atendente', email, password: 'senha-atend-1', roleCode: 'seller', storeIds: [storeId] } }), 201);
  const seller = ok(await call('/auth/login', { method: 'POST', body: { email, password: 'senha-atend-1' } })).accessToken;
  ok(await call(`/stock/intelligence?storeId=${storeId}`, { token: seller }));
  assert.equal((await call('/purchase-orders', { token: seller })).status, 403);
});

await db.end();
console.log(`\n${passed} verificações ok`);
