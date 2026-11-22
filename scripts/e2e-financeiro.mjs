// Teste ponta a ponta do financeiro: taxas e prazos, contas a receber (gerados pelas vendas, venda cancelada que
// se anula, baixa com valor diferente, desfazer, avulso), DRE por competência e por caixa (com canal) e fluxo de caixa.
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
const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const linha = (dre, key, col = 'marketplace') => dre.lines.find((l) => l.key === key)?.values[col] ?? 0;

const db = new pg.Client({ connectionString: DB });
await db.connect();
console.log('Financeiro: contas a receber, DRE e fluxo de caixa');
const owner = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
const storeId = (await db.query(`SELECT s.id FROM store s JOIN tenant t ON t.id = s.tenant_id WHERE t.slug = $1 AND s.active ORDER BY s.created_at LIMIT 1`, [SLUG])).rows[0].id;
await db.query(`UPDATE cash_session SET status = 'closed', closed_at = now() WHERE status = 'open' AND store_id = $1`, [storeId]);
ok(await call('/cash/open', { token: owner, method: 'POST', body: { storeId, openingAmount: 0 } }), 201);
// Vendas deste teste vão para o canal "marketplace": a coluna do DRE fica só com elas.
await db.query(`UPDATE sale SET channel = 'loja' WHERE channel = 'marketplace' AND tenant_id = (SELECT id FROM tenant WHERE slug = $1)`, [SLUG]);
const metodos = ok(await call('/payment-methods', { token: owner }));
const credito = metodos.find((m) => m.kind === 'credito' && m.name === 'Cartão de crédito');
const pix = metodos.find((m) => m.kind === 'pix' && m.name === 'Pix');
const taxasAntes = ok(await call('/payment-fees', { token: owner }));
const cfgAntes = ok(await call('/finance/config', { token: owner }));
const product = async (body) => ok(await call('/products', { token: owner, method: 'POST', body: { trackStock: false, minStock: 0, kind: 'revenda', ...body } }), 201);
const p100 = await product({ name: `Fin 100 ${tag}`, price: 100, cost: 40 });
const p50 = await product({ name: `Fin 50 ${tag}`, price: 50, cost: 20 });
const vender = (prod, methodId, total) => call('/sales', { token: owner, method: 'POST', body: { storeId, channel: 'marketplace', items: [{ productId: prod.id, quantity: 1 }], payments: [{ methodId, amount: total }] } });
const recebiveis = async (q = 'status=todos') => ok(await call(`/receivables?${q}&search=Venda`, { token: owner }));
let vendaA, vendaB, vendaC;

await check('taxas e prazos: salva e valida', async () => {
  const novas = taxasAntes.map((m) => (m.id === credito.id ? { ...m, feePct: 5, feeFixed: 0.5, settleDays: 10, reconcile: true } : m));
  const r = ok(await call('/payment-fees', { token: owner, method: 'PUT', body: { methods: novas.map(({ id, feePct, feeFixed, settleDays, reconcile }) => ({ id, feePct, feeFixed, settleDays, reconcile })) } }));
  assert.equal(r.find((m) => m.id === credito.id).feePct, 5);
  assert.equal((await call('/payment-fees', { token: owner, method: 'PUT', body: { methods: [{ id: credito.id, feePct: 80, feeFixed: 0, settleDays: 1, reconcile: false }] } })).status, 400);
});

await check('venda no cartão vira recebível líquido no prazo; Pix cai na hora', async () => {
  vendaA = ok(await vender(p100, credito.id, 100), 201);
  vendaB = ok(await vender(p50, pix.id, 50), 201);
  const lista = await recebiveis();
  const a = lista.find((r) => r.description === `Venda nº ${vendaA.number}`);
  assert.deepEqual([a.gross, a.fee, a.net, a.dueDate, a.status], [100, 5.5, 94.5, addDays(hoje, 10), 'aberto']);
  const b = lista.find((r) => r.description === `Venda nº ${vendaB.number}`);
  assert.deepEqual([b.fee, b.status, b.receivedDate], [0, 'recebido', hoje]);
  const resumo = ok(await call('/receivables/summary', { token: owner }));
  assert.ok(resumo.next30 >= 94.5);
});

await check('venda cancelada antes de cair: venda e estorno se anulam', async () => {
  vendaC = ok(await vender(p100, credito.id, 100), 201);
  ok(await call(`/sales/${vendaC.id}/cancel`, { token: owner, method: 'POST', body: { reason: 'Teste do financeiro' } }), 201);
  const lista = await recebiveis();
  const doC = lista.filter((r) => r.description.endsWith(`nº ${vendaC.number}`));
  assert.equal(doC.length, 2);
  assert.ok(doC.every((r) => r.status === 'cancelado'));
});

await check('baixa com valor diferente, desfazer e baixa de novo', async () => {
  const a = (await recebiveis()).find((r) => r.description === `Venda nº ${vendaA.number}`);
  ok(await call('/receivables/settle', { token: owner, method: 'POST', body: { ids: [a.id], receivedDate: hoje, amount: '94,00' } }));
  let agora = (await recebiveis('status=recebido')).find((r) => r.id === a.id);
  assert.equal(agora.receivedAmount, 94);
  assert.equal((await call('/receivables/settle', { token: owner, method: 'POST', body: { ids: [a.id], receivedDate: hoje } })).status, 409);
  ok(await call(`/receivables/${a.id}/reopen`, { token: owner, method: 'POST' }));
  agora = (await recebiveis('status=aberto')).find((r) => r.id === a.id);
  assert.equal(agora.status, 'aberto');
  ok(await call('/receivables/settle', { token: owner, method: 'POST', body: { ids: [a.id], receivedDate: hoje, amount: 94 } }));
});

await check('DRE por competência: receita, CMV e taxa no canal certo; impostos estimados', async () => {
  ok(await call('/finance/config', { token: owner, method: 'PUT', body: { impostoPct: 6 } }));
  const d = ok(await call(`/reports/dre?view=competencia&from=${hoje}&to=${hoje}`, { token: owner }));
  assert.ok(d.columns.some((c) => c.key === 'marketplace'));
  assert.equal(linha(d, 'vendas_tabela'), 150);
  assert.equal(linha(d, 'impostos'), 9);
  assert.equal(linha(d, 'receita_liquida'), 141);
  assert.equal(linha(d, 'cmv'), 60);
  assert.equal(linha(d, 'taxas'), 5.5, 'venda cancelada não entra');
  const total = d.lines.find((l) => l.key === 'resultado').values;
  const soma = d.columns.filter((c) => c.key !== 'total').reduce((s, c) => s + total[c.key], 0);
  assert.ok(Math.abs(soma - total.total) < 0.011, 'os canais somam o total');
  assert.ok(d.previous.from < d.from);
});

await check('DRE por caixa: entra o que caiu (já sem taxa), pela data do recebimento', async () => {
  const d = ok(await call(`/reports/dre?view=caixa&from=${hoje}&to=${hoje}`, { token: owner }));
  assert.equal(linha(d, 'entradas'), 144);
  const fora = ok(await call(`/reports/dre?view=caixa&from=${addDays(hoje, -40)}&to=${addDays(hoje, -35)}`, { token: owner }));
  assert.equal(linha(fora, 'entradas', 'total') >= 0, true);
});

await check('fluxo de caixa: realizado + previsto e saldo acumulado', async () => {
  const r = ok(await call('/receivables', { token: owner, method: 'POST', body: { description: `Reembolso ${tag}`, amount: '30,00', dueDate: addDays(hoje, 3) } }), 201);
  const f = ok(await call(`/reports/cashflow?from=${hoje}&to=${addDays(hoje, 5)}&opening=1000`, { token: owner }));
  assert.equal(f.days.length, 6);
  const d3 = f.days.find((d) => d.date === addDays(hoje, 3));
  assert.ok(d3.inExpected >= 30);
  assert.equal(f.days.at(-1).balance, Math.round((1000 + f.days.reduce((s, d) => s + d.net, 0)) * 100) / 100);
  ok(await call(`/receivables/${r.id}/cancel`, { token: owner, method: 'POST' }));
  assert.equal((await call(`/receivables/${(await recebiveis()).find((x) => x.kind === 'venda').id}/cancel`, { token: owner, method: 'POST' })).status, 409);
});

await check('permissões: atendente não vê o financeiro', async () => {
  const email = `seller-fin-${tag}@teste.local`;
  ok(await call('/users', { token: owner, method: 'POST', body: { name: 'Teste fin', email, password: 'senha-teste-123', roleCode: 'seller', storeIds: [storeId] } }));
  const seller = ok(await call('/auth/login', { method: 'POST', body: { email, password: 'senha-teste-123' } })).accessToken;
  for (const p of ['/receivables', `/reports/dre?from=${hoje}&to=${hoje}`, `/reports/cashflow?from=${hoje}&to=${hoje}`]) assert.equal((await call(p, { token: seller })).status, 403, p);
});

// Volta como estava.
ok(await call('/payment-fees', { token: owner, method: 'PUT', body: { methods: taxasAntes.map(({ id, feePct, feeFixed, settleDays, reconcile }) => ({ id, feePct, feeFixed, settleDays, reconcile })) } }));
ok(await call('/finance/config', { token: owner, method: 'PUT', body: cfgAntes }));
await db.end();
console.log(`\n${passed} verificações do financeiro passaram.`);
