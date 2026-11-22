// Teste ponta a ponta: plano de contas, contas financeiras com extrato, contas a pagar classificadas,
// DRE em árvore com lançamentos, funcionários, ponto (PIN, duplicada, ajuste, ocorrência, espelho) e folha.
import assert from 'node:assert/strict';

const BASE = (process.env.E2E_BASE ?? 'http://localhost:3000') + '/v1';
const OWNER = { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
if (!OWNER.email || !OWNER.password) {
  console.error('Defina E2E_EMAIL e E2E_PASSWORD');
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
const mes = hoje.slice(0, 7);
const r2 = (v) => Math.round(v * 100) / 100;

console.log('Gestão: plano de contas, contas, DRE detalhado, funcionários e ponto');
const owner = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
const stores = ok(await call('/stores', { token: owner }));
let conta, banco, caixa, pagavel;

await check('plano de contas padrão, conta nova dentro de um grupo e validações', async () => {
  const plano = ok(await call('/chart-accounts', { token: owner }));
  assert.ok(plano.find((c) => c.code === '5.2.1' && !c.group));
  assert.ok(plano.find((c) => c.code === '5.2' && c.group));
  const codigo = `5.3.${10 + Math.floor(Math.random() * 80)}`;
  const nova = ok(await call('/chart-accounts', { token: owner, method: 'POST', body: { code: codigo, name: `Teste ${tag}`, dreLine: 'despesa_operacional' } }), 201);
  conta = { id: nova.id, code: codigo };
  assert.equal((await call('/chart-accounts', { token: owner, method: 'POST', body: { code: codigo, name: 'Repetida', dreLine: 'despesa_operacional' } })).status, 409);
  assert.equal((await call('/chart-accounts', { token: owner, method: 'POST', body: { code: '55.9.1', name: 'Sem pai', dreLine: 'despesa_operacional' } })).status, 422);
});

await check('contas financeiras: saldo inicial, transferência e extrato', async () => {
  banco = ok(await call('/financial-accounts', { token: owner, method: 'POST', body: { name: `Banco ${tag}`, kind: 'banco', openingBalance: '1.000,00', openingDate: hoje } }), 201);
  caixa = ok(await call('/financial-accounts', { token: owner, method: 'POST', body: { name: `Cofre ${tag}`, kind: 'caixa', openingBalance: 0, openingDate: hoje } }), 201);
  ok(await call('/account-moves', { token: owner, method: 'POST', body: { kind: 'transferencia', accountId: banco.id, toAccountId: caixa.id, amount: 200, date: hoje } }), 201);
  const contas = ok(await call('/financial-accounts', { token: owner }));
  assert.equal(contas.find((c) => c.id === banco.id).balance, 800);
  assert.equal(contas.find((c) => c.id === caixa.id).balance, 200);
  assert.equal((await call('/account-moves', { token: owner, method: 'POST', body: { kind: 'transferencia', accountId: banco.id, toAccountId: banco.id, amount: 10, date: hoje } })).status, 422);
});

await check('conta a pagar na conta do plano: paga pelo banco, aparece no extrato e some ao reabrir', async () => {
  const grupo = ok(await call('/chart-accounts', { token: owner })).find((c) => c.code === '5.3');
  assert.equal((await call('/payables', { token: owner, method: 'POST', body: { description: 'Em grupo', chartAccountId: grupo.id, amount: 10, dueDate: hoje } })).status, 422);
  [pagavel] = ok(await call('/payables', { token: owner, method: 'POST', body: { description: `Despesa ${tag}`, chartAccountId: conta.id, amount: '123,45', dueDate: hoje, document: 'NF 77' } }), 201);
  assert.ok(pagavel.chartAccount.startsWith(conta.code));
  ok(await call(`/payables/${pagavel.id}/pay`, { token: owner, method: 'POST', body: { paidDate: hoje, accountId: banco.id } }), 201);
  let ext = ok(await call(`/financial-accounts/${banco.id}/statement?from=${hoje}&to=${hoje}`, { token: owner }));
  assert.equal(ext.closing, r2(800 - 123.45));
  assert.ok(ext.entries.some((e) => e.amount === -123.45 && !e.manual));
  ok(await call(`/payables/${pagavel.id}/reopen`, { token: owner, method: 'POST' }), 201);
  ext = ok(await call(`/financial-accounts/${banco.id}/statement?from=${hoje}&to=${hoje}`, { token: owner }));
  assert.equal(ext.closing, 800);
  ok(await call(`/payables/${pagavel.id}/pay`, { token: owner, method: 'POST', body: { paidDate: hoje, accountId: banco.id } }), 201);
});

await check('DRE em árvore: a conta aparece dentro do subgrupo, com os lançamentos', async () => {
  for (const view of ['competencia', 'caixa']) {
    const d = ok(await call(`/reports/dre?view=${view}&from=${hoje}&to=${hoje}`, { token: owner }));
    const linha = d.lines.find((l) => l.accountId === conta.id);
    assert.ok(linha, view);
    assert.equal(linha.level, 3);
    assert.ok(linha.values.total >= 123.45);
    const sub = d.lines.find((l) => l.key === linha.parent);
    assert.equal(sub.code, '5.3');
    const grupo = d.lines.find((l) => l.key === 'despesas_operacionais');
    assert.ok(grupo.values.total >= sub.values.total && sub.values.total >= linha.values.total);
    const entradas = ok(await call(`/reports/dre/entries?accountId=${conta.id}&view=${view}&from=${hoje}&to=${hoje}`, { token: owner }));
    assert.ok(entradas.some((e) => e.id === pagavel.id && e.amount === 123.45));
  }
  const d = ok(await call(`/reports/dre?view=competencia&from=${hoje}&to=${hoje}`, { token: owner }));
  const vendas = d.lines.find((l) => l.key === 'vendas_tabela');
  const cats = d.lines.filter((l) => l.parent === 'vendas_tabela');
  assert.ok(Math.abs(cats.reduce((s, l) => s + l.values.total, 0) - vendas.values.total) < 0.02, 'categorias somam as vendas');
  const res = (k) => d.lines.find((l) => l.key === k).values.total;
  const grupos = ['receita_bruta', 'deducoes', 'custos', 'despesas_venda', 'despesas_operacionais', 'resultado_financeiro', 'impostos_lucro'];
  const soma = grupos.reduce((s, k) => s + d.lines.find((l) => l.key === k).sign * res(k), 0);
  assert.ok(Math.abs(soma - res('resultado')) < 0.02, 'o resultado fecha com os grupos');
});

let func, escala;
await check('funcionário com escala e PIN', async () => {
  escala = ok(await call('/hr/schedules', { token: owner, method: 'POST', body: { name: `Comercial ${tag}`, days: [null, ...Array(5).fill({ entrada: '08:00', saidaIntervalo: '12:00', voltaIntervalo: '13:00', saida: '17:00' }), null] } }), 201);
  func = ok(await call('/hr/employees', { token: owner, method: 'POST', body: { name: `Func Teste ${tag}`, role: 'Atendente', admission: `${mes}-01`, salary: '2.000,00', scheduleId: escala.id, storeId: stores[0].id, pin: '4821' } }), 201);
  const lista = ok(await call('/hr/employees', { token: owner }));
  const f = lista.find((e) => e.id === func.id);
  assert.equal(f.salary, 2000);
  assert.equal(f.hasPin, true);
  assert.equal(JSON.stringify(f).includes('4821'), false);
});

await check('bater ponto com PIN: errado recusa, certo registra, repetida em 1 min recusa', async () => {
  assert.equal((await call('/hr/clock/punch', { token: owner, method: 'POST', body: { employeeId: func.id, pin: '0000' } })).status, 403);
  const r = ok(await call('/hr/clock/punch', { token: owner, method: 'POST', body: { employeeId: func.id, pin: '4821' } }), 201);
  assert.ok(r.nsr > 0 && r.hash.length === 64);
  assert.equal(r.today.length, 1);
  assert.equal((await call('/hr/clock/punch', { token: owner, method: 'POST', body: { employeeId: func.id, pin: '4821' } })).status, 409);
  const kiosk = ok(await call('/hr/clock/kiosk', { token: owner }));
  assert.ok(kiosk.some((e) => e.id === func.id));
});

await check('espelho: batida ímpar fica pendente; ajuste com motivo resolve; ocorrência abona', async () => {
  let m = ok(await call(`/hr/clock/mirror/${func.id}?month=${mes}`, { token: owner }));
  const dia = m.days.find((d) => d.date === hoje);
  assert.equal(dia.punches.length, 1);
  assert.equal((await call('/hr/clock/adjustments', { token: owner, method: 'POST', body: { employeeId: func.id, type: 'inclusao', date: hoje, time: '00:01', reason: 'x' } })).status, 400);
  const aj = ok(await call('/hr/clock/adjustments', { token: owner, method: 'POST', body: { employeeId: func.id, type: 'desconsiderar', recordId: dia.punches[0].id, reason: 'Batida de teste' } }), 201);
  m = ok(await call(`/hr/clock/mirror/${func.id}?month=${mes}`, { token: owner }));
  assert.equal(m.days.find((d) => d.date === hoje).punches[0].ignored, true);
  ok(await call(`/hr/clock/adjustments/${aj.id}`, { token: owner, method: 'DELETE' }));
  if (hoje.slice(8) !== '01') {
    const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    ok(await call('/hr/clock/occurrences', { token: owner, method: 'POST', body: { employeeId: func.id, type: 'atestado', from: ontem, to: ontem } }), 201);
    m = ok(await call(`/hr/clock/mirror/${func.id}?month=${mes}`, { token: owner }));
    const d = m.days.find((x) => x.date === ontem);
    assert.equal(d.occurrence, 'Atestado médico');
    assert.equal(d.absent, false);
  }
  const hojeLista = ok(await call('/hr/clock/today', { token: owner }));
  assert.ok(hojeLista.some((e) => e.id === func.id && e.punches.length === 1));
});

await check('folha: salários viram contas a pagar uma vez só', async () => {
  const r = ok(await call('/hr/payroll', { token: owner, method: 'POST', body: { month: mes, employeeIds: [func.id] } }), 201);
  assert.equal(r.created, 1);
  assert.equal(r.total, 2000);
  assert.equal(ok(await call('/hr/payroll', { token: owner, method: 'POST', body: { month: mes, employeeIds: [func.id] } }), 201).created, 0);
  const lista = ok(await call(`/payables?status=open&q=${encodeURIComponent(`Func Teste ${tag}`)}`, { token: owner }));
  assert.equal(lista.items.length, 1);
  assert.ok(lista.items[0].chartAccount.startsWith('5.1.1'));
});

await check('permissões: atendente bate ponto mas não vê funcionários, plano nem contas', async () => {
  const email = `seller-gestao-${tag}@teste.local`;
  ok(await call('/users', { token: owner, method: 'POST', body: { name: 'Teste gestao', email, password: 'senha-teste-123', roleCode: 'seller', storeIds: [stores[0].id] } }));
  const seller = ok(await call('/auth/login', { method: 'POST', body: { email, password: 'senha-teste-123' } })).accessToken;
  for (const p of ['/hr/employees', '/hr/clock/today', '/chart-accounts', '/financial-accounts', `/hr/clock/mirror/${func.id}`]) assert.equal((await call(p, { token: seller })).status, 403, p);
  ok(await call('/hr/clock/me', { token: seller }));
  assert.equal((await call('/hr/clock/punch', { token: seller, method: 'POST', body: {} })).status, 403);
});

// Limpeza do que dá para desfazer.
await call(`/payables/${pagavel.id}/reopen`, { token: owner, method: 'POST' });
await call(`/payables/${pagavel.id}/cancel`, { token: owner, method: 'POST' });
for (const c of [banco, caixa]) await call(`/financial-accounts/${c.id}`, { token: owner, method: 'PUT', body: { name: c === banco ? `Banco ${tag}` : `Cofre ${tag}`, kind: c === banco ? 'banco' : 'caixa', openingBalance: 0, active: false } });
await call(`/hr/employees/${func.id}`, { token: owner, method: 'PUT', body: { name: `Func Teste ${tag}`, admission: `${mes}-01`, active: false, clocks: false } });
console.log(`\n${passed} verificações de gestão passaram.`);
