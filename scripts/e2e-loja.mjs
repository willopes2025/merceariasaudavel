// Teste ponta a ponta da Fase 1 da Mercearia: produtos com lote, ficha técnica,
// clube (preço de membro e cashback), caixa e venda, cancelamento, perdas,
// contagem dos insumos, metas, painel e TV.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const pg = require('pg');
const BASE = (process.env.E2E_BASE ?? 'http://localhost:3000') + '/v1';
const DB = process.env.E2E_DATABASE_URL;
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
async function login(email, password) {
  const r = await call('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.accessToken;
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
const stockOf = async (productId) => (await call(`/products/${productId}`, { token: owner })).body.totalStock;

const db = new pg.Client({ connectionString: DB });
await db.connect();
console.log('Mercearia · Loja física · ponta a ponta');
const owner = await login(OWNER.email, OWNER.password);
const store = ok(await call('/stores', { token: owner })).find((s) => s.code === 'loja');
await db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open'`);
const methods = ok(await call('/payment-methods', { token: owner }));
const by = (kind) => methods.find((m) => m.kind === kind);
const cats = ok(await call('/categories', { token: owner }));
const cat = (name) => cats.find((c) => c.name === name)?.id ?? null;

async function userWith(role) {
  const email = `${role}-${tag}-${Math.random().toString(36).slice(2, 6)}@teste.local`;
  ok(await call('/users', { token: owner, method: 'POST', body: { name: `${role} teste`, email, password: 'senha-teste-123', roleCode: role, storeIds: [] } }), 201);
  return login(email, 'senha-teste-123');
}

const product = async (body) => ok(await call('/products', { token: owner, method: 'POST', body: { trackStock: true, cost: 0, minStock: 0, ...body } }), 201);
const barcode = (n) => `789${String(Date.now()).slice(-7)}${n}`;

// ------------------------------------------------------------- cadastro
let whey, leite, copo, shake, granola;
await check('produtos: revenda com lote e preço de membro, granel, insumos e preparado', async () => {
  whey = await product({ name: `Whey 900g ${tag}`, kind: 'revenda', categoryId: cat('Proteínas'), barcode: barcode(1), unit: 'UN', price: 189.9, memberPrice: 169.9, cost: 110, trackLots: true, minStock: 3, ncm: '21069030' });
  assert.equal(whey.memberPrice, 169.9);
  leite = await product({ name: `Leite vegetal ${tag}`, kind: 'insumo', categoryId: cat('Insumos do preparo'), unit: 'L', price: 0, cost: 8, sellable: false });
  copo = await product({ name: `Copo 400ml ${tag}`, kind: 'insumo', unit: 'UN', price: 0, cost: 0.5, sellable: false });
  granola = await product({ name: `Granola a granel ${tag}`, kind: 'revenda', categoryId: cat('Granel'), unit: 'KG', soldByWeight: true, price: 39.9, memberPrice: 35.9, cost: 18, ncm: '19042000' });
  shake = await product({ name: `Shake proteico ${tag}`, kind: 'preparado', categoryId: cat('Shakes'), unit: 'UN', price: 22, memberPrice: 19, ncm: '22029900', trackStock: true });
  assert.equal(shake.trackStock, false, 'preparado não controla estoque');
  const bad = await call('/products', { token: owner, method: 'POST', body: { name: 'Errado', kind: 'revenda', price: 10, memberPrice: 12, cost: 1, trackStock: true, minStock: 0 } });
  assert.equal(bad.status, 400, 'preço de membro maior que o normal é recusado');
  const dup = await call('/products', { token: owner, method: 'POST', body: { name: 'Dup', kind: 'revenda', price: 1, cost: 0, barcode: whey.barcode, trackStock: true, minStock: 0 } });
  assert.equal(dup.status, 409);
});

await check('ficha técnica do shake: whey em kg, leite em litro, copo', async () => {
  // Whey a granel para o preparo: insumo em KG, separado do pote vendido.
  const wheyKg = await product({ name: `Whey insumo ${tag}`, kind: 'insumo', unit: 'KG', price: 0, cost: 120, sellable: false });
  const r = ok(await call(`/products/${shake.id}/recipe`, { token: owner, method: 'PUT', body: { items: [{ ingredientId: wheyKg.id, quantity: '0,030' }, { ingredientId: leite.id, quantity: 0.25 }, { ingredientId: copo.id, quantity: 1 }] } }));
  assert.equal(r.recipe.length, 3);
  // 0,03 × 120 + 0,25 × 8 + 1 × 0,5 = 3,60 + 2,00 + 0,50
  assert.equal(r.recipeCost, 6.1);
  shake.wheyKg = wheyKg;
  const self = await call(`/products/${shake.id}/recipe`, { token: owner, method: 'PUT', body: { items: [{ ingredientId: shake.id, quantity: 1 }] } });
  assert.equal(self.status, 422);
});

await check('entrada com lote e validade; lote obrigatório quando o produto controla', async () => {
  const noLot = await call(`/products/${whey.id}/stock`, { token: owner, method: 'POST', body: { type: 'entrada', storeId: store.id, quantity: 5 } });
  assert.equal(noLot.status, 422);
  ok(await call(`/products/${whey.id}/stock`, { token: owner, method: 'POST', body: { type: 'entrada', storeId: store.id, quantity: 2, lotCode: 'L-VELHO', expiresAt: '2027-01-10' } }));
  ok(await call(`/products/${whey.id}/stock`, { token: owner, method: 'POST', body: { type: 'entrada', storeId: store.id, quantity: 4, lotCode: 'L-NOVO', expiresAt: '2027-06-30', unitCost: 112.5 } }));
  for (const [p, q] of [[shake.wheyKg, 2], [leite, 10], [copo, 100], [granola, 5]]) ok(await call(`/products/${p.id}/stock`, { token: owner, method: 'POST', body: { type: 'entrada', storeId: store.id, quantity: q } }));
  const d = ok(await call(`/products/${whey.id}`, { token: owner }));
  assert.equal(d.totalStock, 6);
  assert.equal(d.cost, 112.5, 'custo da última compra');
  assert.deepEqual(d.lots.map((l) => [l.code, l.quantity]), [['L-VELHO', 2], ['L-NOVO', 4]]);
});

await check('caixa acha produto pelo código de barras e pelo nome', async () => {
  const byCode = ok(await call(`/products/lookup?q=${whey.barcode}&storeId=${store.id}`, { token: owner }));
  assert.equal(byCode.length, 1);
  assert.equal(byCode[0].stock, 6);
  const byName = ok(await call(`/products/lookup?q=${encodeURIComponent('granola ' + tag)}`, { token: owner }));
  assert.equal(byName[0].id, granola.id);
  const insumo = ok(await call(`/products/lookup?q=${encodeURIComponent('copo 400ml ' + tag)}`, { token: owner }));
  assert.equal(insumo.length, 0, 'insumo não vendável não aparece no caixa');
});

// ------------------------------------------------------------- clube
let member, regular;
await check('clube: 2% de cashback, membro cadastrado no balcão com celular', async () => {
  ok(await call('/club', { token: owner, method: 'PUT', body: { cashbackPct: '2', cashbackDays: 90, cashbackMaxUsePct: 50 } }));
  const run = String(Date.now() % 100000).padStart(5, '0');
  const noPhone = await call('/customers', { token: owner, method: 'POST', body: { name: 'Sem celular', isMember: true } });
  assert.equal(noPhone.status, 400);
  member = ok(await call('/customers', { token: owner, method: 'POST', body: { name: `Ana Membro ${tag}`, phone: `(27) 99${run}-11`, isMember: true, goal: 'massa' } }), 201);
  assert.equal(member.isMember, true);
  assert.equal(member.memberSource, 'loja');
  regular = ok(await call('/customers', { token: owner, method: 'POST', body: { name: `Bia Comum ${tag}`, phone: `(27) 98${run}-22` } }), 201);
  const found = ok(await call(`/customers/search?q=${member.phone.slice(-8)}`, { token: owner }));
  assert.equal(found[0].id, member.id);
});

// ------------------------------------------------------------- venda
await check('sem caixa aberto não vende', async () => {
  const r = await call('/sales', { token: owner, method: 'POST', body: { storeId: store.id, items: [{ productId: granola.id, quantity: 1 }], payments: [{ methodId: by('pix').id, amount: 39.9 }] } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'CASH_CLOSED');
});

let cashier, session;
await check('caixa abre com troco', async () => {
  cashier = await userWith('cashier');
  session = ok(await call('/cash/open', { token: cashier, method: 'POST', body: { storeId: store.id, openingAmount: 100 } }), 201);
  assert.equal(session.status, 'open');
});

let sale1;
await check('orçamento do caixa: membro paga preço de membro; não membro vê quanto economizaria', async () => {
  const items = [{ productId: whey.id, quantity: 1 }, { productId: granola.id, quantity: '0,350' }, { productId: shake.id, quantity: 2 }];
  const q1 = ok(await call('/sales/quote', { token: cashier, method: 'POST', body: { storeId: store.id, customerId: member.id, items } }), 201);
  // 169,90 + 0,35 × 35,90 (12,565 → 12,57) + 2 × 19 = 220,47
  assert.equal(q1.member, true);
  assert.equal(q1.total, 220.47);
  assert.equal(q1.grossTotal, 189.9 + 13.97 + 44);
  assert.equal(q1.memberSavings, Math.round((q1.grossTotal - 220.47) * 100) / 100);
  assert.equal(q1.cashbackEarned, 4.4, '2% de 220,47');
  const q2 = ok(await call('/sales/quote', { token: cashier, method: 'POST', body: { storeId: store.id, customerId: regular.id, items } }), 201);
  assert.equal(q2.member, false);
  assert.equal(q2.cashbackEarned, 0);
  assert.equal(q2.wouldSaveAsMember, q1.memberSavings);
  const whole = await call('/sales/quote', { token: cashier, method: 'POST', body: { storeId: store.id, items: [{ productId: whey.id, quantity: 1.5 }] } });
  assert.equal(whole.status, 422, 'pote de whey não vende quebrado');
});

await check('venda do membro: troco, cashback, FEFO no whey e insumos do shake baixados', async () => {
  const items = [{ productId: whey.id, quantity: 1 }, { productId: granola.id, quantity: 0.35 }, { productId: shake.id, quantity: 2 }];
  const short = await call('/sales', { token: cashier, method: 'POST', body: { storeId: store.id, customerId: member.id, items, payments: [{ methodId: by('pix').id, amount: 200 }] } });
  assert.equal(short.status, 422);
  const overCard = await call('/sales', { token: cashier, method: 'POST', body: { storeId: store.id, customerId: member.id, items, payments: [{ methodId: by('credito').id, amount: 230 }] } });
  assert.equal(overCard.status, 422, 'cartão não dá troco');
  sale1 = ok(await call('/sales', { token: cashier, method: 'POST', body: { storeId: store.id, customerId: member.id, items, payments: [{ methodId: by('pix').id, amount: 120.47 }, { methodId: by('dinheiro').id, amount: 150 }] } }), 201);
  assert.equal(sale1.total, 220.47);
  assert.equal(sale1.change, 50);
  assert.equal(sale1.cashbackEarned, 4.4);
  assert.equal(sale1.memberPricing, true);
  const w = ok(await call(`/products/${whey.id}`, { token: owner }));
  assert.deepEqual(w.lots.map((l) => [l.code, l.quantity]), [['L-VELHO', 1], ['L-NOVO', 4]], 'saiu do lote que vence primeiro');
  assert.equal(await stockOf(granola.id), 4.65);
  assert.equal(await stockOf(shake.wheyKg.id), 1.94);
  assert.equal(await stockOf(leite.id), 9.5);
  assert.equal(await stockOf(copo.id), 98);
  const c = ok(await call(`/customers/${member.id}`, { token: owner }));
  assert.equal(c.cashbackBalance, 4.4);
  assert.equal(c.stats.purchases, 1);
});

await check('caixa: dinheiro na gaveta conta só o que ficou (sem o troco)', async () => {
  const s = ok(await call(`/cash/sessions/${session.id}`, { token: cashier }));
  assert.equal(s.expectedCash, 200, '100 de troco + 150 − 50');
  assert.equal(s.sales.count, 1);
  assert.equal(s.sales.total, 220.47);
});

let sale2;
await check('membro usa cashback (até 50% da compra) e ganha sobre o que pagou', async () => {
  const q = ok(await call('/sales/quote', { token: cashier, method: 'POST', body: { storeId: store.id, customerId: member.id, items: [{ productId: shake.id, quantity: 1 }], useCashback: 100 } }), 201);
  assert.equal(q.cashbackAvailable, 4.4);
  assert.equal(q.cashbackUsed, 4.4);
  assert.equal(q.total, 14.6);
  sale2 = ok(await call('/sales', { token: cashier, method: 'POST', body: { storeId: store.id, customerId: member.id, items: [{ productId: shake.id, quantity: 1 }], useCashback: 100, payments: [{ methodId: by('debito').id, amount: 14.6 }] } }), 201);
  assert.equal(sale2.cashbackUsed, 4.4);
  assert.equal(sale2.cashbackEarned, 0.29);
  const c = ok(await call(`/customers/${member.id}`, { token: owner }));
  assert.equal(c.cashbackBalance, 0.29);
  const ext = ok(await call(`/customers/${member.id}/cashback`, { token: owner }));
  assert.deepEqual(ext.map((e) => e.type), ['credito', 'uso', 'credito']);
});

await check('desconto só para quem pode (atendente não)', async () => {
  const seller = await userWith('seller');
  const r = await call('/sales', { token: seller, method: 'POST', body: { storeId: store.id, items: [{ productId: granola.id, quantity: 1 }], discount: 5, payments: [{ methodId: by('pix').id, amount: 34.9 }] } });
  assert.equal(r.status, 403);
});

await check('cancelar venda: estorna pagamentos, devolve estoque nos mesmos lotes e desfaz o cashback', async () => {
  const cancelSeller = await userWith('seller');
  const denied = await call(`/sales/${sale1.id}/cancel`, { token: cancelSeller, method: 'POST', body: { reason: 'Cliente desistiu' } });
  assert.equal(denied.status, 403);
  const r = ok(await call(`/sales/${sale1.id}/cancel`, { token: owner, method: 'POST', body: { reason: 'Cliente desistiu' } }), 201);
  assert.equal(r.status, 'canceled');
  assert.ok(r.payments.filter((p) => p.amount > 0).every((p) => p.reversed));
  const w = ok(await call(`/products/${whey.id}`, { token: owner }));
  assert.deepEqual(w.lots.map((l) => [l.code, l.quantity]), [['L-VELHO', 2], ['L-NOVO', 4]]);
  assert.equal(await stockOf(copo.id), 99, 'volta o copo dos 2 shakes (o 3º shake continua vendido)');
  // Ganhou 4,40 na venda 1, usou na venda 2 e ganhou 0,29: só dá para tirar o que sobrou.
  const c = ok(await call(`/customers/${member.id}`, { token: owner }));
  assert.equal(c.cashbackBalance, 0);
  const again = await call(`/sales/${sale1.id}/cancel`, { token: owner, method: 'POST', body: { reason: 'De novo' } });
  assert.equal(again.status, 409);
  const s = ok(await call(`/cash/sessions/${session.id}`, { token: cashier }));
  assert.equal(s.expectedCash, 100, 'o dinheiro líquido (100) saiu da gaveta');
});

// ------------------------------------------------------------- perdas e contagem
await check('perda por validade sai do lote escolhido e entra no valor das perdas', async () => {
  const w = ok(await call(`/products/${whey.id}`, { token: owner }));
  const old = w.lots.find((l) => l.code === 'L-VELHO');
  const kitchen = await userWith('kitchen');
  const r = ok(await call(`/products/${whey.id}/stock`, { token: kitchen, method: 'POST', body: { type: 'perda', storeId: store.id, quantity: 1, reason: 'vencido', lotId: old.id } }), 201);
  assert.equal(r.lots.find((l) => l.code === 'L-VELHO').quantity, 1);
  const entry = await call(`/products/${whey.id}/stock`, { token: kitchen, method: 'POST', body: { type: 'entrada', storeId: store.id, quantity: 1, lotCode: 'X', expiresAt: null } });
  assert.equal(entry.status, 403, 'equipe do preparo lança perda, mas não dá entrada');
});

await check('contagem do fim do dia: a diferença vira perda de contagem', async () => {
  const kitchen = await userWith('kitchen');
  const sheet = ok(await call(`/kitchen/count-sheet?storeId=${store.id}&scope=insumos`, { token: kitchen }));
  const line = sheet.find((l) => l.productId === leite.id);
  assert.equal(line.system, 9.75, '10 − 0,25 do shake que ficou vendido');
  const count = ok(await call('/kitchen/counts', { token: kitchen, method: 'POST', body: { storeId: store.id, scope: 'insumos', lines: [{ productId: leite.id, counted: '9,25' }, { productId: copo.id, counted: 99 }] } }), 201);
  assert.equal(count.lines.find((l) => l.productId === leite.id).diff, -0.5);
  assert.equal(count.diffValue, -4, 'faltou meio litro a R$ 8');
  assert.equal(await stockOf(leite.id), 9.25);
});

await check('relatório de perdas: uso previsto pela ficha, perda e margem do shake', async () => {
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const r = ok(await call(`/kitchen/losses?from=${today}&to=${today}&storeId=${store.id}`, { token: owner }));
  const l = r.byProduct.find((x) => x.productId === leite.id);
  assert.equal(l.expectedUse, 0.25);
  assert.equal(l.countMissing, 0.5);
  const s = r.recipes.find((x) => x.productId === shake.id);
  assert.equal(s.cost, 6.1);
  assert.equal(s.sold, 1);
  assert.ok(r.byReason.some((x) => x.reason === 'vencido'));
});

// ------------------------------------------------------------- metas, painel e TV
let tv;
await check('meta do mês, painel do dia e tela de TV pública sem dado de cliente', async () => {
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const start = `${today.slice(0, 7)}-01`;
  const end = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const goal = ok(await call('/goals', { token: owner, method: 'POST', body: { name: `Faturamento ${tag}`, metric: 'faturamento', scope: 'loja', storeId: store.id, startDate: start, endDate: end, target: 30000 } }), 201);
  assert.ok(goal.progress.actual >= 14.6);
  const bad = await call('/goals', { token: owner, method: 'POST', body: { name: 'Sem pessoa', metric: 'faturamento', scope: 'vendedor', startDate: start, endDate: end, target: 10 } });
  assert.equal(bad.status, 400);
  const dash = ok(await call(`/dashboard?storeId=${store.id}`, { token: owner }));
  assert.ok(dash.today.count >= 1);
  assert.ok(dash.alerts.cashOpen);
  tv = ok(await call('/tv-screens', { token: owner, method: 'POST', body: { storeId: store.id, name: 'TV do balcão', mode: 'equipe' } }), 201);
  const pub = ok(await call(`/tv/${tv.path.split('/').pop()}`));
  assert.equal(pub.storeName, store.name);
  assert.ok(pub.offers.some((o) => o.name === whey.name && o.memberPrice === 169.9));
  assert.ok(!JSON.stringify(pub).includes(member.name), 'TV não mostra cliente');
  const rotated = ok(await call(`/tv-screens/${tv.id}/rotate`, { token: owner, method: 'POST', body: { storeId: store.id, name: 'TV do balcão', mode: 'equipe' } }), 201);
  assert.equal((await call(`/tv/${tv.path.split('/').pop()}`)).status, 404, 'link antigo para de funcionar');
  ok(await call(`/tv/${rotated.path.split('/').pop()}`));
});

await check('resumo do período: vendas, perdas e cashback', async () => {
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const r = ok(await call(`/reports/period?from=${today}&to=${today}&storeId=${store.id}`, { token: owner }));
  assert.ok(r.sales.count >= 1);
  assert.ok(r.sales.canceled >= 1);
  assert.ok(r.losses.total >= 4);
  assert.ok(r.cashback.used >= 4.4);
});

await check('isolamento: venda de outra organização não aparece', async () => {
  const other = await db.query(`INSERT INTO tenant (id, name) VALUES (gen_random_uuid(), 'Outra ${tag}') RETURNING id`);
  const r = await call(`/sales/${sale2.id}`, { token: owner });
  assert.equal(r.status, 200);
  const fake = await call(`/sales/00000000-0000-0000-0000-000000000000`, { token: owner });
  assert.equal(fake.status, 404);
  await db.query('DELETE FROM tenant WHERE id = $1', [other.rows[0].id]);
});

await check('fecha o caixa com a contagem', async () => {
  const closed = ok(await call(`/cash/sessions/${session.id}/close`, { token: cashier, method: 'POST', body: { countedAmount: 100 } }), 201);
  assert.equal(closed.difference, 0);
});

await db.end();
console.log(`\n${passed} verificações passaram.`);
