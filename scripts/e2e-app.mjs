// Teste ponta a ponta do app do cliente (Fase 2a): vitrine, cadastro = clube,
// login por celular + PIN, código do balcão, troca de PIN, cartão de membro no
// caixa, compras e extrato de cashback, e a separação entre token de cliente e
// token da equipe.
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
console.log('Mercearia · App do cliente · ponta a ponta');
const owner = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
const store = ok(await call('/stores', { token: owner })).find((s) => s.code === 'loja');
const methods = ok(await call('/payment-methods', { token: owner }));
const pix = methods.find((m) => m.kind === 'pix');
// O app não depende de caixa aberto, mas as compras de teste sim.
await db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open' AND store_id = $1`, [store.id]);
ok(await call('/cash/open', { token: owner, method: 'POST', body: { storeId: store.id, openingAmount: 0 } }), 201);

const product = async (body) => ok(await call('/products', { token: owner, method: 'POST', body: { trackStock: false, cost: 0, minStock: 0, ...body } }), 201);
const whey = await product({ name: `Whey app ${tag}`, kind: 'revenda', price: 100, memberPrice: 85, description: 'Proteína do soro do leite', imageUrl: 'https://exemplo.com/whey.jpg' });
const escondido = await product({ name: `Escondido app ${tag}`, kind: 'revenda', price: 10, showInApp: false });
const insumo = await product({ name: `Insumo app ${tag}`, kind: 'insumo', price: 0, sellable: true });

await check('vitrine pública: regras do clube e catálogo com preço de membro', async () => {
  const info = ok(await call(shop()));
  assert.equal(info.slug, SLUG);
  assert.ok('cashbackPct' in info.club);
  const cat = ok(await call(shop('/catalog')));
  const w = cat.products.find((p) => p.id === whey.id);
  assert.equal(w.price, 100);
  assert.equal(w.memberPrice, 85);
  assert.equal(w.description, 'Proteína do soro do leite');
  assert.ok(!cat.products.some((p) => p.id === escondido.id), 'produto fora do app não aparece');
  assert.ok(!cat.products.some((p) => p.id === insumo.id), 'insumo não aparece');
  assert.equal((await call('/shop/nao-existe/catalog')).status, 404);
});

const phone = randomPhone();
let token, me;
await check('cadastro pelo app vira membro com cartão', async () => {
  const weak = await call(shop('/signup'), { method: 'POST', body: { name: 'Ana App', phone, pin: '123456', acceptTerms: true } });
  assert.equal(weak.status, 400, 'PIN fácil é recusado');
  const noTerms = await call(shop('/signup'), { method: 'POST', body: { name: 'Ana App', phone, pin: '482915' } });
  assert.equal(noTerms.status, 400, 'sem aceitar as regras não cadastra');
  const r = ok(await call(shop('/signup'), { method: 'POST', body: { name: 'Ana App', phone, pin: '482915', goal: 'massa', acceptTerms: true } }), 201);
  token = r.token;
  assert.equal(r.mustChangePin, false);
  me = ok(await call(shop('/me'), { token }));
  assert.equal(me.name, 'Ana App');
  assert.match(me.memberCode, /^[A-Z2-9]{6}$/);
  const staffView = ok(await call(`/customers/${me.id}`, { token: owner }));
  assert.equal(staffView.isMember, true);
  assert.equal(staffView.memberSource, 'app');
  assert.equal(staffView.appAccess, 'ativo');
});

await check('mesmo celular não cadastra duas vezes', async () => {
  const r = await call(shop('/signup'), { method: 'POST', body: { name: 'Outra', phone, pin: '739204', acceptTerms: true } });
  assert.equal(r.status, 409);
  assert.equal(code(r), 'ALREADY_SIGNED_UP');
});

await check('login por celular + PIN (formato livre do celular)', async () => {
  const bad = await call(shop('/login'), { method: 'POST', body: { phone, pin: '000001' } });
  assert.equal(bad.status, 401);
  const formatted = `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`;
  const r = ok(await call(shop('/login'), { method: 'POST', body: { phone: formatted, pin: '482915' } }), 201);
  assert.ok(r.token);
});

await check('token de cliente e token da equipe não se misturam', async () => {
  assert.equal((await call('/customers', { token })).status, 401);
  assert.equal((await call('/products', { token })).status, 401);
  assert.equal((await call(shop('/me'), { token: owner })).status, 401);
  assert.equal((await call(shop('/me'))).status, 401);
});

await check('caixa acha o membro pelo código do cartão', async () => {
  const found = ok(await call(`/customers/search?q=${me.memberCode.toLowerCase()}`, { token: owner }));
  assert.ok(found.some((c) => c.id === me.id));
});

await check('compra no caixa aparece no app com economia e cashback', async () => {
  const sale = ok(await call('/sales', { token: owner, method: 'POST', body: { storeId: store.id, customerId: me.id, items: [{ productId: whey.id, quantity: 2 }], payments: [{ methodId: pix.id, amount: 170 }] } }), 201);
  const purchases = ok(await call(shop('/me/purchases'), { token }));
  const p = purchases.find((x) => x.id === sale.id);
  assert.equal(p.total, 170);
  assert.equal(p.memberSavings, 30);
  assert.equal(p.items[0].quantity, 2);
  const after = ok(await call(shop('/me'), { token }));
  assert.equal(after.totalSavings, 30);
  assert.equal(after.purchases, 1);
  const statement = ok(await call(shop('/me/cashback'), { token }));
  if (sale.cashbackEarned > 0) {
    assert.equal(after.cashbackBalance, sale.cashbackEarned);
    assert.ok(statement.some((e) => e.kind === 'credito' && e.description.includes(`nº ${sale.number}`)));
  }
});

await check('perfil: cliente atualiza os próprios dados', async () => {
  const r = ok(await call(shop('/me'), { token, method: 'PUT', body: { name: 'Ana App Silva', email: 'ana@exemplo.com', goal: 'emagrecer', allowWhatsapp: false } }));
  assert.equal(r.name, 'Ana App Silva');
  assert.equal(r.goal, 'emagrecer');
});

await check('trocar PIN pede o atual e derruba o login antigo', async () => {
  const wrong = await call(shop('/me/pin'), { token, method: 'POST', body: { current: '111112', pin: '918273' } });
  assert.equal(code(wrong), 'PIN_MISMATCH');
  const r = ok(await call(shop('/me/pin'), { token, method: 'POST', body: { current: '482915', pin: '918273' } }), 201);
  assert.equal((await call(shop('/me'), { token })).status, 401, 'token antigo caiu');
  token = r.token;
  ok(await call(shop('/me'), { token }));
});

// Cliente que a loja já conhece (comprou no balcão) e nunca usou o app.
const known = randomPhone();
let knownId;
await check('celular já conhecido pela loja: só com código do balcão', async () => {
  const c = ok(await call('/customers', { token: owner, method: 'POST', body: { name: 'Bia Balcão', phone: known, isMember: true } }), 201);
  knownId = c.id;
  assert.match(c.memberCode, /^[A-Z2-9]{6}$/, 'membro do balcão também ganha cartão');
  ok(await call('/sales', { token: owner, method: 'POST', body: { storeId: store.id, customerId: knownId, items: [{ productId: whey.id, quantity: 1 }], payments: [{ methodId: pix.id, amount: 85 }] } }), 201);
  const r = await call(shop('/signup'), { method: 'POST', body: { name: 'Intrusa', phone: known, pin: '564738', acceptTerms: true } });
  assert.equal(r.status, 409);
  assert.equal(code(r), 'CONFIRM_AT_STORE');
});

await check('código do balcão: entra, cria o PIN e segue', async () => {
  const access = ok(await call(`/customers/${knownId}/app-access`, { token: owner, method: 'POST' }), 201);
  assert.match(access.code, /^\d{6}$/);
  assert.equal(ok(await call(`/customers/${knownId}`, { token: owner })).appAccess, 'provisorio');
  const login = ok(await call(shop('/login'), { method: 'POST', body: { phone: known, pin: access.code } }), 201);
  assert.equal(login.mustChangePin, true);
  const r = ok(await call(shop('/me/pin'), { token: login.token, method: 'POST', body: { pin: '372819' } }), 201);
  assert.equal(r.mustChangePin, false);
  const bia = ok(await call(shop('/me'), { token: r.token }));
  assert.equal(bia.name, 'Bia Balcão');
  assert.equal(bia.purchases, 1);
  assert.equal((await call(shop('/login'), { method: 'POST', body: { phone: known, pin: access.code } })).status, 401, 'código provisório não vale mais');
  assert.equal(ok(await call(`/customers/${knownId}`, { token: owner })).appAccess, 'ativo');
});

await check('5 PINs errados travam o login', async () => {
  for (let i = 0; i < 5; i++) await call(shop('/login'), { method: 'POST', body: { phone: known, pin: '000009' } });
  const r = await call(shop('/login'), { method: 'POST', body: { phone: known, pin: '372819' } });
  assert.equal(r.status, 429);
  assert.equal(code(r), 'LOGIN_LOCKED');
  // Código novo do balcão destrava.
  await db.query(`UPDATE customer_access SET locked_until = NULL WHERE customer_id = $1`, [knownId]);
});

await check('cadastro desativado perde o acesso', async () => {
  const c = ok(await call(`/customers/${me.id}`, { token: owner }));
  ok(await call(`/customers/${me.id}`, { token: owner, method: 'PUT', body: { name: c.name, phone: c.phone, isMember: true, active: false, goal: c.goal, email: c.email, allowWhatsapp: c.allowWhatsapp } }));
  assert.equal((await call(shop('/me'), { token })).status, 401);
});

await db.end();
console.log(`\n${passed} verificações ok`);
