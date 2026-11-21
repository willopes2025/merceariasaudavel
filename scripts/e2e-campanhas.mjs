// Teste ponta a ponta de recompra e campanhas: oferta (preço promocional para
// todos e só para membros), cupom (limites, membro, aniversário, cancelamento
// libera o uso), cashback turbinado por categoria e dia da semana, listas de
// recompra / clientes sumidas / aniversariantes e o "Hora de repor" do app.
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
const TAG = tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6);
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
// Hoje no horário de Brasília.
const todayBR = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const weekday = new Date(`${todayBR}T12:00:00Z`).getUTCDay();
const month = Number(todayBR.slice(5, 7));
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const db = new pg.Client({ connectionString: DB });
await db.connect();
console.log('Mercearia · Recompra e campanhas · ponta a ponta');
const owner = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
const storeId = (await db.query(`SELECT s.id FROM store s JOIN tenant t ON t.id = s.tenant_id WHERE t.slug = $1 AND s.active ORDER BY s.created_at LIMIT 1`, [SLUG])).rows[0].id;
const pix = ok(await call('/payment-methods', { token: owner })).find((m) => m.kind === 'pix');
await db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open' AND store_id = $1`, [storeId]);
ok(await call('/cash/open', { token: owner, method: 'POST', body: { storeId, openingAmount: 0 } }), 201);
ok(await call('/club', { token: owner, method: 'PUT', body: { cashbackPct: 2, cashbackDays: 0, cashbackMaxUsePct: 100, ordersEnabled: true, kitchenFromCounter: true } }));
// Campanhas de testes anteriores não atrapalham.
await db.query(`UPDATE campaign SET active = false WHERE tenant_id = (SELECT id FROM tenant WHERE slug = $1)`, [SLUG]);

const cat = ok(await call('/categories', { token: owner, method: 'POST', body: { name: `Barras ${tag}` } }), 201);
const product = async (body) => ok(await call('/products', { token: owner, method: 'POST', body: { trackStock: false, cost: 0, minStock: 0, kind: 'revenda', ...body } }), 201);
const whey = await product({ name: `Whey camp ${tag}`, price: 100, memberPrice: 90, repurchaseDays: 30 });
const barra = await product({ name: `Barra camp ${tag}`, price: 10, categoryId: cat.id });
const customer = async (name, extra = {}) => ok(await call('/customers', { token: owner, method: 'POST', body: { name, phone: randomPhone(), isMember: true, ...extra } }), 201);
const ana = await customer('Ana Camp');
const quote = (body) => call('/sales/quote', { token: owner, method: 'POST', body: { storeId, ...body } });
const sell = (body, total) => call('/sales', { token: owner, method: 'POST', body: { storeId, payments: total > 0 ? [{ methodId: pix.id, amount: total }] : [], ...body } });
const campaign = (body) => call('/campaigns', { token: owner, method: 'POST', body: { startsOn: todayBR, endsOn: addDays(todayBR, 7), ...body } });

await check('oferta: preço promocional para todos e um ainda menor só para membros', async () => {
  const off = ok(await campaign({ name: `Semana do whey ${tag}`, type: 'oferta', products: [{ productId: whey.id, promoPrice: '80,00' }] }), 201);
  assert.equal(off.runningNow, true);
  let q = ok(await quote({ items: [{ productId: whey.id, quantity: 1 }] }));
  assert.equal(q.items[0].unitPrice, 80);
  assert.equal(q.items[0].campaign.name, off.name);
  assert.equal(q.promoSavings, 20);
  q = ok(await quote({ customerId: ana.id, items: [{ productId: whey.id, quantity: 1 }] }));
  assert.equal(q.items[0].unitPrice, 80);
  assert.equal(q.memberSavings, 10, 'parte do preço de membro');
  assert.equal(q.promoSavings, 10, 'parte da oferta');
  ok(await campaign({ name: `Membro VIP ${tag}`, type: 'oferta', audience: 'membros', products: [{ productId: whey.id, promoPrice: 75 }] }), 201);
  assert.equal(ok(await quote({ customerId: ana.id, items: [{ productId: whey.id, quantity: 1 }] })).items[0].unitPrice, 75);
  assert.equal(ok(await quote({ items: [{ productId: whey.id, quantity: 1 }] })).items[0].unitPrice, 80);
  // App mostra a oferta aberta a todos.
  const catalog = ok(await call(shop('/catalog')));
  const w = catalog.products.find((p) => p.id === whey.id);
  assert.equal(w.offer.price, 80);
  assert.equal(w.offer.membersOnly, false);
});

await check('oferta fora do dia da semana não vale', async () => {
  const other = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== weekday);
  ok(await campaign({ name: `Barra de outro dia ${tag}`, type: 'oferta', weekdays: other, products: [{ productId: barra.id, promoPrice: 5 }] }), 201);
  assert.equal(ok(await quote({ items: [{ productId: barra.id, quantity: 1 }] })).items[0].unitPrice, 10);
});

let welcome;
await check('cupom só para membro, compra mínima e 1 por cliente', async () => {
  welcome = ok(await campaign({ name: `Boas-vindas ${tag}`, type: 'cupom', code: `bem${TAG}`, discountPct: 10, minPurchase: 50, maxPerCustomer: 1, audience: 'membros' }), 201);
  assert.equal(welcome.code, `BEM${TAG}`);
  const dup = await campaign({ name: 'Outro', type: 'cupom', code: `BEM${TAG}`, discountAmount: 5 });
  assert.equal(code(dup), 'COUPON_CODE_TAKEN');
  let q = ok(await quote({ couponCode: welcome.code, items: [{ productId: whey.id, quantity: 1 }] }));
  assert.match(q.couponError, /Identifique a cliente/);
  assert.equal(q.coupon, null);
  q = ok(await quote({ customerId: ana.id, couponCode: welcome.code, items: [{ productId: barra.id, quantity: 1 }] }));
  assert.match(q.couponError, /a partir de R\$ 50,00/);
  q = ok(await quote({ customerId: ana.id, couponCode: welcome.code.toLowerCase(), items: [{ productId: whey.id, quantity: 1 }] }));
  assert.equal(q.coupon.discount, 7.5, '10% de 75');
  assert.equal(q.total, 67.5);
  const sale = ok(await sell({ customerId: ana.id, couponCode: welcome.code, items: [{ productId: whey.id, quantity: 1 }] }, 67.5), 201);
  assert.equal(sale.couponCode, welcome.code);
  assert.equal(sale.couponDiscount, 7.5);
  assert.equal(sale.discount, 7.5, 'desconto total inclui o cupom (nota rateia)');
  assert.equal(sale.total, 67.5);
  const again = ok(await quote({ customerId: ana.id, couponCode: welcome.code, items: [{ productId: whey.id, quantity: 1 }] }));
  assert.match(again.couponError, /já usou/);
  const blocked = await sell({ customerId: ana.id, couponCode: welcome.code, items: [{ productId: whey.id, quantity: 1 }] }, 75);
  assert.equal(code(blocked), 'COUPON_INVALID');
  // Cancelar a venda devolve o uso do cupom.
  ok(await call(`/sales/${sale.id}/cancel`, { token: owner, method: 'POST', body: { reason: 'Teste do cupom' } }), 201);
  assert.equal(ok(await quote({ customerId: ana.id, couponCode: welcome.code, items: [{ productId: whey.id, quantity: 1 }] })).coupon.discount, 7.5);
});

await check('cupom com limite total e código que não existe', async () => {
  const flash = ok(await campaign({ name: `Relâmpago ${tag}`, type: 'cupom', code: `REL${TAG}`, discountAmount: '5', maxUses: 1 }), 201);
  ok(await sell({ couponCode: flash.code, items: [{ productId: barra.id, quantity: 1 }] }, 5), 201);
  const second = ok(await quote({ couponCode: flash.code, items: [{ productId: barra.id, quantity: 1 }] }));
  assert.match(second.couponError, /limite de usos/);
  const none = ok(await quote({ couponCode: 'NAOEXISTE', items: [{ productId: barra.id, quantity: 1 }] }));
  assert.match(none.couponError, /não encontrado/);
  assert.equal(none.total, 10, 'a conta sai sem o cupom');
  assert.equal(code(await sell({ couponCode: 'NAOEXISTE', items: [{ productId: barra.id, quantity: 1 }] }, 10)), 'COUPON_INVALID');
});

await check('cashback turbinado na categoria: +3% só nas barras, para membro', async () => {
  ok(await campaign({ name: `Barra em dobro ${tag}`, type: 'cashback', extraCashbackPct: 3, scope: 'categorias', categoryIds: [cat.id] }), 201);
  const q = ok(await quote({ customerId: ana.id, items: [{ productId: barra.id, quantity: 5 }, { productId: whey.id, quantity: 1 }] }));
  // Pago 50 + 75 = 125 → base 2% = 2,50; extra 3% sobre as barras (50) = 1,50.
  assert.equal(q.campaignCashback, 1.5);
  assert.equal(q.cashbackEarned, 4);
  assert.equal(ok(await quote({ items: [{ productId: barra.id, quantity: 5 }] })).campaignCashback, 0, 'não membro não ganha cashback');
  const sale = ok(await sell({ customerId: ana.id, items: [{ productId: barra.id, quantity: 5 }, { productId: whey.id, quantity: 1 }] }, 125), 201);
  assert.equal(sale.campaignCashback, 1.5);
  assert.equal(sale.cashbackEarned, 4);
  const info = ok(await call(shop()));
  assert.ok(info.campaigns.some((c) => c.type === 'cashback' && c.extraCashbackPct === 3));
  assert.ok(!info.campaigns.some((c) => c.name.startsWith('Boas-vindas')), 'cupom não aparece no app');
});

let bia;
await check('aniversariante: caixa sugere o cupom e ele vale uma vez no ano', async () => {
  bia = await customer('Bia Aniversário', { birthDate: `1990-${String(month).padStart(2, '0')}-10` });
  const bday = ok(await campaign({ name: `Aniversário ${tag}`, type: 'cupom', code: `NIVER${TAG}`, discountPct: 15, audience: 'aniversariantes', endsOn: addDays(todayBR, 30) }), 201);
  const q = ok(await quote({ customerId: bia.id, items: [{ productId: barra.id, quantity: 2 }] }));
  assert.equal(q.birthdayCoupon.code, bday.code);
  const used = ok(await sell({ customerId: bia.id, couponCode: bday.code, items: [{ productId: barra.id, quantity: 2 }] }, 17), 201);
  assert.equal(used.couponDiscount, 3);
  const again = ok(await quote({ customerId: bia.id, couponCode: bday.code, items: [{ productId: barra.id, quantity: 2 }] }));
  assert.match(again.couponError, /já usou/);
  assert.equal(ok(await quote({ customerId: bia.id, items: [{ productId: barra.id, quantity: 1 }] })).birthdayCoupon, null, 'não sugere de novo');
  const notBday = ok(await quote({ customerId: ana.id, couponCode: bday.code, items: [{ productId: barra.id, quantity: 1 }] }));
  assert.match(notBday.couponError, /data de nascimento|mês do aniversário/);
});

await check('resultado das campanhas: usos, faturamento e desconto', async () => {
  const list = ok(await call('/campaigns', { token: owner }));
  const w = list.find((c) => c.id === welcome.id);
  assert.equal(w.stats.sales, 0, 'venda cancelada não conta');
  const offer = list.find((c) => c.name === `Membro VIP ${tag}`);
  assert.ok(offer.stats.sales >= 1);
  assert.ok(offer.stats.discount > 0);
  const boost = list.find((c) => c.name === `Barra em dobro ${tag}`);
  assert.ok(boost.stats.cashback >= 1.5);
});

// Recompra: cliente com uma compra de whey há 35 dias (produto dura 30) e outra com o próprio ritmo.
const carla = await customer('Carla Recompra');
const dani = await customer('Dani Ritmo');
const backdate = async (saleId, days) => db.query(`UPDATE sale SET created_at = now() - make_interval(days => $2) WHERE id = $1`, [saleId, days]);
await check('recompra: pela duração do produto e pelo ritmo da cliente', async () => {
  // Ofertas desligadas para o preço não importar aqui.
  await db.query(`UPDATE campaign SET active = false WHERE name LIKE $1`, [`%${tag}`]);
  const s1 = ok(await sell({ customerId: carla.id, items: [{ productId: whey.id, quantity: 1 }] }, 90), 201);
  await backdate(s1.id, 35);
  const d1 = ok(await sell({ customerId: dani.id, items: [{ productId: barra.id, quantity: 1 }] }, 10), 201);
  const d2 = ok(await sell({ customerId: dani.id, items: [{ productId: barra.id, quantity: 1 }] }, 10), 201);
  await backdate(d1.id, 38);
  await backdate(d2.id, 18);
  const list = ok(await call('/growth/repurchase?ahead=7', { token: owner }));
  const c = list.find((r) => r.customerId === carla.id && r.productId === whey.id);
  assert.equal(c.basis, 'produto');
  assert.equal(c.intervalDays, 30);
  assert.equal(c.daysLate, 5);
  const d = list.find((r) => r.customerId === dani.id && r.productId === barra.id);
  assert.equal(d.basis, 'cliente');
  assert.equal(d.intervalDays, 20);
  assert.equal(d.daysLate, -2, 'vence em 2 dias');
  ok(await call('/growth/contacts', { token: owner, method: 'POST', body: { customerId: carla.id, productId: whey.id, kind: 'recompra' } }), 201);
  const after = ok(await call('/growth/repurchase', { token: owner })).find((r) => r.customerId === carla.id && r.productId === whey.id);
  assert.ok(after.lastContactAt, 'contato marcado');
});

await check('app: "Hora de repor" mostra o produto para a própria cliente', async () => {
  const phone = randomPhone();
  const signup = ok(await call(shop('/signup'), { method: 'POST', body: { name: 'Eva Repor', phone, pin: '739215', acceptTerms: true, birthDate: '1995-03-02' } }), 201);
  const me = ok(await call(shop('/me'), { token: signup.token }));
  assert.equal(me.birthDate, '1995-03-02');
  const s = ok(await sell({ customerId: me.id, items: [{ productId: whey.id, quantity: 1 }] }, 90), 201);
  await backdate(s.id, 28);
  const due = ok(await call(shop('/me/repurchase'), { token: signup.token }));
  assert.equal(due[0].product.id, whey.id);
  assert.equal(due[0].dueDate, addDays(todayBR, 2));
});

await check('clientes sumidas e aniversariantes do mês', async () => {
  const fia = await customer('Fia Sumida');
  const s = ok(await sell({ customerId: fia.id, items: [{ productId: whey.id, quantity: 2 }] }, 180), 201);
  await backdate(s.id, 60);
  const lapsed = ok(await call('/growth/lapsed?days=45', { token: owner }));
  const f = lapsed.find((r) => r.customerId === fia.id);
  assert.equal(f.totalSpent, 180);
  assert.ok(f.daysAway >= 59);
  const bdays = ok(await call(`/growth/birthdays?month=${month}`, { token: owner }));
  assert.ok(bdays.some((r) => r.customerId === bia.id && r.day === 10));
  const summary = ok(await call('/growth/summary', { token: owner }));
  assert.ok(summary.lapsed >= 1);
  assert.match(summary.messages.repurchase, /\{produto\}/);
  const saved = ok(await call('/growth/messages', { token: owner, method: 'PUT', body: { repurchase: 'Oi {nome}, seu {produto} acabou?', lapsed: null, birthday: null } }));
  assert.equal(saved.repurchase, 'Oi {nome}, seu {produto} acabou?');
  assert.match(saved.lapsed, /cashback/);
  ok(await call('/growth/messages', { token: owner, method: 'PUT', body: { repurchase: null, lapsed: null, birthday: null } }));
});

await check('atendente vê as listas mas não cria campanha', async () => {
  const email = `atend-camp-${tag}@teste.local`;
  ok(await call('/users', { token: owner, method: 'POST', body: { name: 'Atendente', email, password: 'senha-atend-1', roleCode: 'seller', storeIds: [] } }), 201);
  const seller = ok(await call('/auth/login', { method: 'POST', body: { email, password: 'senha-atend-1' } })).accessToken;
  ok(await call('/growth/repurchase', { token: seller }));
  assert.equal((await call('/campaigns', { token: seller })).status, 403);
});

await db.end();
console.log(`\n${passed} verificações ok`);
