// Teste ponta a ponta dos pedidos (Fase 2b): montagem do shake (sabor e
// adicionais com preço e insumo), pedido pelo app e pelo totem pago no caixa,
// tela de preparo (fila → preparando → pronto → entregue), painel de retirada,
// pedido automático do balcão e cancelamentos.
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
console.log('Mercearia · Pedidos e preparo · ponta a ponta');
const owner = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
// Pedido do app/totem vai para a primeira loja ativa da organização do endereço.
const storeId = (await db.query(`SELECT s.id FROM store s JOIN tenant t ON t.id = s.tenant_id WHERE t.slug = $1 AND s.active ORDER BY s.created_at LIMIT 1`, [SLUG])).rows[0].id;
const store = ok(await call('/stores', { token: owner })).find((s) => s.id === storeId);
const pix = ok(await call('/payment-methods', { token: owner })).find((m) => m.kind === 'pix');
await db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open' AND store_id = $1`, [store.id]);
ok(await call('/cash/open', { token: owner, method: 'POST', body: { storeId: store.id, openingAmount: 0 } }), 201);
ok(await call('/club', { token: owner, method: 'PUT', body: { cashbackPct: 0, cashbackDays: 0, cashbackMaxUsePct: 100, ordersEnabled: true, kitchenFromCounter: true } }));

const product = async (body) => ok(await call('/products', { token: owner, method: 'POST', body: { trackStock: false, cost: 0, minStock: 0, ...body } }), 201);
const stockOf = async (id) => ok(await call(`/products/${id}`, { token: owner })).stock.find((s) => s.storeId === store.id)?.quantity ?? 0;

let shake, groups, pasta, whey;
await check('montagem do shake: sabor (escolhe 1) e adicionais com preço e insumo', async () => {
  whey = await product({ name: `Whey kg ${tag}`, kind: 'insumo', unit: 'KG', price: 0, cost: 100, sellable: false, trackStock: true });
  pasta = await product({ name: `Pasta amendoim kg ${tag}`, kind: 'insumo', unit: 'KG', price: 0, cost: 50, sellable: false, trackStock: true });
  for (const p of [whey, pasta]) ok(await call(`/products/${p.id}/stock`, { token: owner, method: 'POST', body: { type: 'entrada', storeId: store.id, quantity: 2 } }));
  shake = await product({ name: `Shake monta ${tag}`, kind: 'preparado', price: 20, memberPrice: 17 });
  ok(await call(`/products/${shake.id}/recipe`, { token: owner, method: 'PUT', body: { items: [{ ingredientId: whey.id, quantity: 0.03 }] } }));
  const bad = await call(`/products/${shake.id}/options`, { token: owner, method: 'PUT', body: { groups: [{ name: 'Sabor', minSelect: 2, maxSelect: 1, options: [{ name: 'A', price: 0 }] }] } });
  assert.equal(bad.status, 400);
  const r = ok(
    await call(`/products/${shake.id}/options`, {
      token: owner,
      method: 'PUT',
      body: {
        groups: [
          { name: 'Sabor', minSelect: 1, maxSelect: 1, options: [{ name: 'Chocolate', price: 0 }, { name: 'Morango', price: 0 }] },
          { name: 'Adicionais', minSelect: 0, maxSelect: 2, options: [{ name: 'Pasta de amendoim', price: '4,00', supplyId: pasta.id, supplyQty: '0,02' }, { name: 'Dose extra de whey', price: 6, supplyId: whey.id, supplyQty: 0.03 }] },
        ],
      },
    }),
  );
  groups = r.optionGroups;
  assert.equal(groups.length, 2);
  assert.equal(groups[1].options[0].supplyName, pasta.name);
  // Salvar de novo mantém os ids (pedido aberto não quebra).
  const again = ok(await call(`/products/${shake.id}/options`, { token: owner, method: 'PUT', body: { groups } }));
  assert.equal(again.optionGroups[0].options[0].id, groups[0].options[0].id);
  const pdv = ok(await call(`/products/lookup?q=${encodeURIComponent(shake.name)}&storeId=${store.id}`, { token: owner }));
  assert.equal(pdv[0].optionGroups.length, 2);
});
const opt = (g, i) => groups[g].options[i].id;

await check('caixa confere a montagem: sabor obrigatório, máximo e opção de outro produto', async () => {
  const q = (options) => call('/sales/quote', { token: owner, method: 'POST', body: { storeId: store.id, items: [{ productId: shake.id, quantity: 1, options }] } });
  assert.equal(code(await q([])), 'OPTION_MISSING');
  assert.equal(code(await q([opt(0, 0), opt(0, 1)])), 'OPTION_TOO_MANY');
  assert.equal(code(await q([opt(0, 0), '00000000-0000-4000-8000-000000000000'])), 'OPTION_NOT_FOUND');
  assert.equal(code(await q([opt(0, 0), opt(0, 0)])), 'OPTION_REPEATED');
  const r = ok(await q([opt(0, 1), opt(1, 0)]));
  assert.equal(r.items[0].unitPrice, 24, 'R$ 20 + R$ 4 da pasta');
  assert.deepEqual(r.items[0].options.map((o) => o.name), ['Morango', 'Pasta de amendoim']);
});

// Cliente do app.
const phone = randomPhone();
const signup = ok(await call(shop('/signup'), { method: 'POST', body: { name: 'Duda Pedido', phone, pin: '647382', acceptTerms: true } }), 201);
const ctoken = signup.token;
const me = ok(await call(shop('/me'), { token: ctoken }));

let appOrder;
await check('app: catálogo traz a montagem e o pedido sai com preço de membro', async () => {
  const info = ok(await call(shop()));
  assert.equal(info.ordersEnabled, true);
  const cat = ok(await call(shop('/catalog')));
  assert.equal(cat.products.find((p) => p.id === shake.id).optionGroups.length, 2);
  appOrder = ok(await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: [{ productId: shake.id, quantity: 2, options: [opt(0, 0), opt(1, 0), opt(1, 1)] }], notes: 'Sem gelo' } }), 201);
  assert.equal(appOrder.status, 'aguardando_pagamento');
  assert.equal(appOrder.channel, 'app');
  assert.equal(appOrder.callName, 'Duda');
  assert.equal(appOrder.estimate, 54, '2 × (17 membro + 4 + 6)');
  assert.ok(appOrder.number >= 1);
  const mine = ok(await call(shop('/me/orders'), { token: ctoken }));
  assert.equal(mine[0].id, appOrder.id);
});

await check('caixa vê o pedido para cobrar; tela de preparo ainda não', async () => {
  const pending = ok(await call(`/orders/pending?storeId=${store.id}`, { token: owner }));
  assert.ok(pending.some((o) => o.id === appOrder.id));
  const board = ok(await call(`/orders/board?storeId=${store.id}`, { token: owner }));
  assert.ok(!board.some((o) => o.id === appOrder.id));
});

let paidSale;
await check('cobrar o pedido: vai para a fila, baixa insumos dos adicionais e não cobra duas vezes', async () => {
  const pastaBefore = await stockOf(pasta.id);
  const wheyBefore = await stockOf(whey.id);
  const lines = appOrder.items.map((i) => ({ productId: i.productId, quantity: i.quantity, options: i.options.map((o) => o.id) }));
  paidSale = ok(await call('/sales', { token: owner, method: 'POST', body: { storeId: store.id, customerId: me.id, orderId: appOrder.id, items: lines, payments: [{ methodId: pix.id, amount: 54 }] } }), 201);
  assert.equal(paidSale.total, 54);
  assert.equal(paidSale.order.status, 'na_fila');
  assert.deepEqual(paidSale.items[0].options.map((o) => o.name), ['Chocolate', 'Pasta de amendoim', 'Dose extra de whey']);
  assert.equal(Math.round((pastaBefore - (await stockOf(pasta.id))) * 1000) / 1000, 0.04, '2 × 0,02 kg');
  assert.equal(Math.round((wheyBefore - (await stockOf(whey.id))) * 1000) / 1000, 0.12, '2 × (0,03 ficha + 0,03 dose extra)');
  const twice = await call('/sales', { token: owner, method: 'POST', body: { storeId: store.id, orderId: appOrder.id, items: lines, payments: [{ methodId: pix.id, amount: 54 }] } });
  assert.equal(code(twice), 'ORDER_NOT_PENDING');
  const notCancel = await call(shop(`/me/orders/${appOrder.id}/cancel`), { token: ctoken, method: 'POST' });
  assert.equal(code(notCancel), 'ORDER_PAID');
});

const kitchenEmail = `preparo-${tag}@teste.local`;
ok(await call('/users', { token: owner, method: 'POST', body: { name: 'Preparo Teste', email: kitchenEmail, password: 'senha-preparo-1', roleCode: 'kitchen', storeIds: [] } }), 201);
const kitchen = ok(await call('/auth/login', { method: 'POST', body: { email: kitchenEmail, password: 'senha-preparo-1' } })).accessToken;

await check('tela de preparo: fila → preparando → pronto → entregue (painel de retirada acompanha)', async () => {
  const board = ok(await call(`/orders/board?storeId=${store.id}`, { token: kitchen }));
  const o = board.find((x) => x.id === appOrder.id);
  assert.equal(o.status, 'na_fila');
  assert.equal(o.notes, 'Sem gelo');
  assert.equal((await call(`/orders/pending?storeId=${store.id}`, { token: kitchen })).status, 403, 'preparo não cobra');
  ok(await call(`/orders/${appOrder.id}/advance`, { token: kitchen, method: 'POST', body: { status: 'preparando' } }), 201);
  let pickup = ok(await call(shop('/pickup')));
  assert.ok(pickup.preparing.some((p) => p.number === appOrder.number));
  ok(await call(`/orders/${appOrder.id}/advance`, { token: kitchen, method: 'POST', body: { status: 'pronto' } }), 201);
  pickup = ok(await call(shop('/pickup')));
  assert.ok(pickup.ready.some((p) => p.number === appOrder.number && p.callName === 'Duda'));
  assert.equal(JSON.stringify(pickup).includes(phone), false, 'painel não mostra dado da cliente');
  assert.equal(ok(await call(shop(`/me/orders/${appOrder.id}`), { token: ctoken })).status, 'pronto');
  const back = await call(`/orders/${appOrder.id}/advance`, { token: kitchen, method: 'POST', body: { status: 'preparando' } });
  assert.equal(code(back), 'ORDER_STATUS');
  const done = ok(await call(`/orders/${appOrder.id}/advance`, { token: kitchen, method: 'POST', body: { status: 'entregue' } }), 201);
  assert.ok(done.readyAt && done.deliveredAt && done.startedAt);
});

await check('totem: pedido sem login, membro pelo código do cartão', async () => {
  const items = [{ productId: shake.id, quantity: 1, options: [opt(0, 1)] }];
  const anon = ok(await call(shop('/totem/orders'), { method: 'POST', body: { items, callName: 'Rafa Silva' } }), 201);
  assert.equal(anon.channel, 'totem');
  assert.equal(anon.callName, 'Rafa');
  assert.equal(anon.estimate, 20);
  assert.equal(anon.customerId, null);
  const member = ok(await call(shop('/totem/orders'), { method: 'POST', body: { items, callName: 'Duda', member: me.memberCode.toLowerCase() } }), 201);
  assert.equal(member.customerId, me.id);
  assert.equal(member.estimate, 17);
  const wrong = await call(shop('/totem/orders'), { method: 'POST', body: { items, callName: 'X Y', member: '27900000000' } });
  assert.equal(code(wrong), 'MEMBER_NOT_FOUND');
  const noName = await call(shop('/totem/orders'), { method: 'POST', body: { items } });
  assert.equal(noName.status, 400);
  // Caixa cancela o pedido que ninguém veio pagar.
  const c = ok(await call(`/orders/${anon.id}/cancel`, { token: owner, method: 'POST', body: { reason: 'Desistiu' } }), 201);
  assert.equal(c.status, 'cancelado');
  // Cliente cancela o próprio pedido pelo app (o do totem com o cartão dela também).
  const mine = ok(await call(shop(`/me/orders/${member.id}/cancel`), { token: ctoken, method: 'POST' }), 201);
  assert.equal(mine.status, 'cancelado');
});

await check('venda no balcão com shake abre pedido pago na tela de preparo', async () => {
  const sale = ok(await call('/sales', { token: owner, method: 'POST', body: { storeId: store.id, items: [{ productId: shake.id, quantity: 1, options: [opt(0, 0)] }], payments: [{ methodId: pix.id, amount: 20 }] } }), 201);
  assert.ok(sale.order, 'pedido criado');
  const board = ok(await call(`/orders/board?storeId=${store.id}`, { token: kitchen }));
  const o = board.find((x) => x.saleId === sale.id);
  assert.equal(o.channel, 'balcao');
  assert.equal(o.status, 'na_fila');
  assert.equal(o.callName, `Venda ${sale.number}`);
  // Cancelar a venda tira o pedido da fila.
  ok(await call(`/sales/${sale.id}/cancel`, { token: owner, method: 'POST', body: { reason: 'Cliente desistiu' } }), 201);
  const after = ok(await call(`/orders/board?storeId=${store.id}`, { token: kitchen }));
  assert.ok(!after.some((x) => x.saleId === sale.id));
});

await check('loja pausa os pedidos do app/totem', async () => {
  ok(await call('/club', { token: owner, method: 'PUT', body: { cashbackPct: 0, cashbackDays: 0, cashbackMaxUsePct: 100, ordersEnabled: false, kitchenFromCounter: false } }));
  assert.equal(ok(await call(shop())).ordersEnabled, false);
  const r = await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: [{ productId: shake.id, quantity: 1, options: [opt(0, 0)] }] } });
  assert.equal(code(r), 'ORDERS_OFF');
  const sale = ok(await call('/sales', { token: owner, method: 'POST', body: { storeId: store.id, items: [{ productId: shake.id, quantity: 1, options: [opt(0, 0)] }], payments: [{ methodId: pix.id, amount: 20 }] } }), 201);
  assert.equal(sale.order, null, 'balcão sem tela de preparo');
  ok(await call('/club', { token: owner, method: 'PUT', body: { cashbackPct: 0, cashbackDays: 0, cashbackMaxUsePct: 100, ordersEnabled: true, kitchenFromCounter: true } }));
});

await check('pedido não pago em 3 h sai da fila do caixa', async () => {
  const o = ok(await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: [{ productId: shake.id, quantity: 1, options: [opt(0, 0)] }] } }), 201);
  await db.query(`UPDATE "order" SET created_at = now() - interval '4 hours' WHERE id = $1`, [o.id]);
  const pending = ok(await call(`/orders/pending?storeId=${store.id}`, { token: owner }));
  assert.ok(!pending.some((x) => x.id === o.id));
  assert.equal(ok(await call(shop(`/me/orders/${o.id}`), { token: ctoken })).status, 'cancelado');
});

await db.end();
console.log(`\n${passed} verificações ok`);
