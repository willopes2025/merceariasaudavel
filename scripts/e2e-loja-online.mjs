// Teste ponta a ponta da loja online: configuração (descrição, Pixel, GA4),
// origem do cadastro e do pedido (UTM, gclid), relatório por origem e as
// páginas públicas com SEO (título, og:, JSON-LD, robots e sitemap).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const pg = require('pg');
const ROOT = process.env.E2E_BASE ?? 'http://localhost:3000';
const BASE = ROOT + '/v1';
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
const shop = (p = '') => `/shop/${SLUG}${p}`;
const randomPhone = () => `279${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const page = async (path) => {
  const res = await fetch(ROOT + path);
  return { status: res.status, text: await res.text() };
};

const db = new pg.Client({ connectionString: DB });
await db.connect();
console.log('Mercearia · Loja online · ponta a ponta');
const owner = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
const storeId = (await db.query(`SELECT s.id FROM store s JOIN tenant t ON t.id = s.tenant_id WHERE t.slug = $1 AND s.active ORDER BY s.created_at LIMIT 1`, [SLUG])).rows[0].id;
const pix = ok(await call('/payment-methods', { token: owner })).find((m) => m.kind === 'pix' && !m.name.includes('online'));
await db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open' AND store_id = $1`, [storeId]);
ok(await call('/cash/open', { token: owner, method: 'POST', body: { storeId, openingAmount: 0 } }), 201);
await db.query(`UPDATE campaign SET active = false WHERE tenant_id = (SELECT id FROM tenant WHERE slug = $1)`, [SLUG]);
ok(await call('/club', { token: owner, method: 'PUT', body: { cashbackPct: 2, cashbackDays: 0, cashbackMaxUsePct: 100, ordersEnabled: true, kitchenFromCounter: true } }));
const item = ok(await call('/products', { token: owner, method: 'POST', body: { name: `Granola Loja ${tag}`, brand: 'Pacco', kind: 'revenda', price: 30, memberPrice: 27, cost: 10, trackStock: false, minStock: 0, description: 'Granola crocante sem açúcar.' } }), 201);
const CAMP = `bf-${tag}`;

await check('configuração: descrição, Pixel e GA4 validados; app e loja enxergam', async () => {
  assert.equal((await call('/storefront/settings', { token: owner, method: 'PUT', body: { metaPixelId: 'abc' } })).status, 400);
  assert.equal((await call('/storefront/settings', { token: owner, method: 'PUT', body: { ga4Id: 'UA-123' } })).status, 400);
  const s = ok(await call('/storefront/settings', { token: owner, method: 'PUT', body: { shopDescription: 'Suplementos e Pacco em Natal. Retire na loja.', metaPixelId: '1234567890123456', ga4Id: 'g-abc123xyz' } }));
  assert.equal(s.ga4Id, 'G-ABC123XYZ');
  assert.ok(s.url.endsWith('/loja'));
  const info = ok(await call(shop()));
  assert.equal(info.description, 'Suplementos e Pacco em Natal. Retire na loja.');
  assert.deepEqual(info.tracking, { metaPixelId: '1234567890123456', ga4Id: 'G-ABC123XYZ' });
});

let ctoken, meId;
await check('cadastro guarda a origem (UTM); origem inválida é recusada', async () => {
  const long = await call(shop('/signup'), { method: 'POST', body: { name: 'Ana Longa', phone: randomPhone(), pin: '846291', acceptTerms: true, origin: { source: 'x'.repeat(200) } } });
  assert.equal(long.status, 400);
  const r = ok(await call(shop('/signup'), { method: 'POST', body: { name: 'Ana Insta', phone: randomPhone(), pin: '846291', acceptTerms: true, origin: { source: 'instagram', medium: 'bio', campaign: CAMP, landing: '/loja' } } }), 201);
  ctoken = r.token;
  const me = ok(await call(shop('/me'), { token: ctoken }));
  meId = me.id;
  const row = (await db.query(`SELECT origin FROM customer WHERE id = $1`, [me.id])).rows[0];
  assert.equal(row.origin.source, 'instagram');
  assert.equal(row.origin.campaign, CAMP);
});

await check('pedido guarda a origem; relatório por origem soma cadastros, pedidos e vendas pagas', async () => {
  const o1 = ok(await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: [{ productId: item.id, quantity: 2 }], origin: { source: 'facebook', medium: 'cpc', campaign: CAMP } } }), 201);
  ok(await call('/sales', { token: owner, method: 'POST', body: { storeId, orderId: o1.id, customerId: meId, items: [{ productId: item.id, quantity: 2 }], channel: 'app', payments: [{ methodId: pix.id, amount: 54 }] } }), 201);
  ok(await call(shop('/me/orders'), { token: ctoken, method: 'POST', body: { items: [{ productId: item.id, quantity: 1 }], origin: { gclid: `CjwK${tag}`, landing: '/loja/p/x' } } }), 201);
  const rep = ok(await call('/storefront/origins?days=7', { token: owner }));
  const fb = rep.rows.find((r) => r.source === 'facebook' && r.medium === 'cpc' && r.campaign === CAMP);
  assert.deepEqual({ orders: fb.orders, paid: fb.paidOrders, revenue: fb.revenue }, { orders: 1, paid: 1, revenue: 54 });
  const insta = rep.rows.find((r) => r.source === 'instagram' && r.campaign === CAMP);
  assert.equal(insta.newCustomers, 1);
  const google = rep.rows.find((r) => r.source === 'google' && r.medium === 'cpc');
  assert.ok(google.orders >= 1, 'gclid conta como Google Ads');
  assert.ok(rep.totals.orders >= 2);
});

await check('página da loja com título, descrição, og: e dados estruturados', async () => {
  const r = await page('/loja');
  assert.equal(r.status, 200);
  assert.match(r.text, /<meta name="description" content="Suplementos e Pacco em Natal\. Retire na loja\."/);
  assert.match(r.text, /<meta property="og:url" content="[^"]+\/loja"/);
  assert.match(r.text, /"@type":"Store"/);
  assert.match(r.text, /<div id="root">/, 'continua sendo o app');
});

await check('página do produto: nome, preço de membro e JSON-LD de produto; produto inexistente cai no app', async () => {
  const slug = `granola-loja-${tag}`;
  const r = await page(`/loja/p/${item.id}/${slug}`);
  assert.match(r.text, new RegExp(`<title>Granola Loja ${tag} · Pacco \\|`));
  assert.match(r.text, /Membro do clube paga R\$ 27,00/);
  assert.match(r.text, /"@type":"Product"/);
  assert.match(r.text, /"price":"30.00"/);
  assert.match(r.text, new RegExp(`og:url" content="[^"]+/loja/p/${item.id}/${slug}"`));
  const none = await page(`/loja/p/00000000-0000-4000-8000-000000000000/x`);
  assert.equal(none.status, 200);
  assert.ok(!none.text.includes('"@type":"Product"'));
});

await check('robots e sitemap: só a loja aparece no Google', async () => {
  const robots = await page('/robots.txt');
  assert.match(robots.text, /Allow: \/loja/);
  assert.match(robots.text, /Disallow: \//);
  assert.match(robots.text, /Sitemap: .+\/sitemap\.xml/);
  const map = await page('/sitemap.xml');
  assert.match(map.text, /<urlset/);
  assert.ok(map.text.includes(`/loja/p/${item.id}/granola-loja-${tag}`));
});

ok(await call('/storefront/settings', { token: owner, method: 'PUT', body: { shopDescription: null, metaPixelId: null, ga4Id: null } }));
await db.end();
console.log(`\n${passed} verificações passaram.`);
