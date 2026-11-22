// Teste ponta a ponta: conciliação bancária (OFX), orçamento, comissão de vendedor, auditoria, importação e disparos.
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
const ofxDia = (iso) => iso.replaceAll('-', '');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const db = new pg.Client({ connectionString: DB });
await db.connect();
console.log('Controle: conciliação, orçamento, comissão, auditoria, importação e disparos');
const token = ok(await call('/auth/login', { method: 'POST', body: OWNER })).accessToken;
const T = { token };

// ───────────── Conciliação ─────────────
const conta = ok(await call('/financial-accounts', { ...T, method: 'POST', body: { name: `Banco teste ${tag}`, kind: 'banco', openingBalance: '1000', openingDate: addDays(hoje, -40), active: true } }), 201).id;
const plano = ok(await call('/chart-accounts', T));
const despesa = plano.find((c) => c.active && !c.group && c.dreLine === 'despesa_operacional');
const d2 = addDays(hoje, -2);
// Uma conta paga (vai casar sozinha), uma em aberto (baixa pela conciliação) e uma tarifa que o sistema não conhece.
const [paga] = ok(await call('/payables', { ...T, method: 'POST', body: { description: `Aluguel ${tag}`, chartAccountId: despesa.id, amount: '1500,37', dueDate: d2 } }), 201);
ok(await call(`/payables/${paga.id}/pay`, { ...T, method: 'POST', body: { paidDate: d2, accountId: conta } }));
const [aberta] = ok(await call('/payables', { ...T, method: 'POST', body: { description: `Internet ${tag}`, chartAccountId: despesa.id, amount: '129,91', dueDate: hoje } }), 201);
const ofx = `<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${ofxDia(addDays(d2, 1))}<TRNAMT>-1500.37<FITID>${tag}1<MEMO>PIX ALUGUEL</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${ofxDia(addDays(hoje, -1))}<TRNAMT>-129.91<FITID>${tag}2<MEMO>DEB AUT INTERNET</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${ofxDia(addDays(hoje, -1))}<TRNAMT>-12.50<FITID>${tag}3<MEMO>TARIFA PACOTE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${ofxDia(addDays(hoje, -1))}<TRNAMT>3.33<FITID>${tag}4<MEMO>RENDIMENTO</STMTTRN>
</BANKTRANLIST></OFX>`;
const periodo = `from=${addDays(hoje, -10)}&to=${hoje}`;
let rec;
await check('extrato OFX entra, não duplica e casa sozinho o que tem o mesmo valor', async () => {
  const r = ok(await call(`/financial-accounts/${conta}/ofx`, { ...T, method: 'POST', body: { content: ofx } }), 201);
  assert.deepEqual([r.read, r.added, r.matched], [4, 4, 1]);
  const de_novo = ok(await call(`/financial-accounts/${conta}/ofx`, { ...T, method: 'POST', body: { content: ofx } }), 201);
  assert.equal(de_novo.added, 0);
  rec = ok(await call(`/financial-accounts/${conta}/reconciliation?${periodo}`, T));
  assert.deepEqual([rec.pending, rec.matched], [3, 1]);
  ok(await call(`/financial-accounts/${conta}/ofx`, { ...T, method: 'POST', body: { content: 'isto não é um extrato de banco' } }), 422);
});
const linha = (memo) => rec.lines.find((l) => l.memo.includes(memo));
await check('linha pendente sugere a conta em aberto de mesmo valor e dá baixa nela', async () => {
  const l = linha('INTERNET');
  assert.equal(l.payableOptions[0].id, aberta.id);
  ok(await call(`/bank-lines/${l.id}`, { ...T, method: 'POST', body: { action: 'pay', payableId: aberta.id } }), 201);
  const p = (await db.query(`SELECT status, paid_date::text, account_id FROM payable WHERE id = $1`, [aberta.id])).rows[0];
  assert.deepEqual([p.status, p.paid_date, p.account_id], ['paid', addDays(hoje, -1), conta]);
});
await check('lançar o que o sistema não conhecia: despesa entra no plano de contas, entrada sem conta vira ajuste', async () => {
  ok(await call(`/bank-lines/${linha('TARIFA').id}`, { ...T, method: 'POST', body: { action: 'create', chartAccountId: despesa.id, description: `Tarifa ${tag}` } }), 201);
  const p = (await db.query(`SELECT status, amount::float AS v, chart_account_id FROM payable WHERE description = $1`, [`Tarifa ${tag}`])).rows[0];
  assert.deepEqual([p.status, p.v, p.chart_account_id], ['paid', 12.5, despesa.id]);
  ok(await call(`/bank-lines/${linha('RENDIMENTO').id}`, { ...T, method: 'POST', body: { action: 'create' } }), 201);
  rec = ok(await call(`/financial-accounts/${conta}/reconciliation?${periodo}`, T));
  assert.deepEqual([rec.pending, rec.matched, rec.missingInBank.length], [0, 4, 0]);
  // Saldo do sistema = saldo inicial + as quatro linhas do banco.
  const c = ok(await call('/financial-accounts', T)).find((x) => x.id === conta);
  assert.equal(c.balance, Math.round((1000 - 1500.37 - 129.91 - 12.5 + 3.33) * 100) / 100);
});
await check('linha conciliada não muda sem desfazer; desfazer devolve para pendente; ignorar tira da lista', async () => {
  const l = linha('RENDIMENTO');
  ok(await call(`/bank-lines/${l.id}`, { ...T, method: 'POST', body: { action: 'ignore' } }), 409);
  ok(await call(`/bank-lines/${l.id}`, { ...T, method: 'POST', body: { action: 'undo' } }), 201);
  rec = ok(await call(`/financial-accounts/${conta}/reconciliation?${periodo}`, T));
  // Desfeita, a linha casa de novo sozinha com o ajuste que ficou no extrato.
  assert.equal(rec.lines.find((x) => x.id === l.id).status, 'conciliado');
  const errado = rec.lines.find((x) => x.memo.includes('ALUGUEL'));
  ok(await call(`/bank-lines/${errado.id}`, { ...T, method: 'POST', body: { action: 'undo' } }), 201);
  ok(await call(`/bank-lines/${errado.id}`, { ...T, method: 'POST', body: { action: 'match', entryId: rec.lines.find((x) => x.id === l.id).entry.id } }), 422);
});

// ───────────── Orçamento ─────────────
const mes = hoje.slice(0, 7);
await check('orçamento: grava por linha do DRE, compara com o realizado e repete até dezembro', async () => {
  const antes = ok(await call(`/budget?month=${mes}`, T));
  const alvo = antes.rows.find((r) => r.key === `acc_${despesa.id}`);
  assert.ok(alvo, 'a conta com lançamento aparece no orçamento');
  assert.ok(alvo.actual >= 1500.37);
  const r = ok(await call('/budget', { ...T, method: 'PUT', body: { month: mes, copyToYearEnd: true, items: [{ key: alvo.key, amount: '2.000,00' }] } }));
  assert.equal(r.months, 12 - Number(mes.slice(5)) + 1);
  const depois = ok(await call(`/budget?month=${mes}`, T));
  assert.equal(depois.rows.find((x) => x.key === alvo.key).budget, 2000);
  assert.equal(Math.round((depois.resultBudget - antes.resultBudget) * 100) / 100, -2000);
  ok(await call('/budget', { ...T, method: 'PUT', body: { month: mes, items: [{ key: alvo.key, amount: 0 }] } }));
  assert.equal(ok(await call(`/budget?month=${mes}`, T)).rows.find((x) => x.key === alvo.key).budget, 0);
});

// ───────────── Comissão ─────────────
await check('comissão de vendedor: total vendido × percentual do cadastro de funcionário', async () => {
  const me = ok(await call('/auth/me', T));
  const { rows } = await db.query(`SELECT COALESCE(SUM(total + cashback_used - delivery_fee), 0)::float AS v FROM sale WHERE seller_id = $1 AND status = 'completed' AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3`, [me.id, `${mes}-01`, hoje]);
  await db.query(`UPDATE employee SET user_id = NULL WHERE user_id = $1`, [me.id]);
  const emp = ok(await call('/hr/employees', { ...T, method: 'POST', body: { name: `Vendedora ${tag}`, admission: hoje, userId: me.id, commissionPct: '2,5' } }), 201);
  const lista = ok(await call(`/reports/seller-commission?from=${mes}-01&to=${hoje}`, T));
  const eu = lista.find((x) => x.userId === me.id);
  if (rows[0].v > 0) {
    assert.equal(eu.total, Math.round(rows[0].v * 100) / 100);
    assert.equal(eu.pct, 2.5);
    assert.equal(eu.commission, Math.round((Math.round(eu.total * 100) * 2.5) / 100) / 100);
  }
  await db.query(`UPDATE employee SET user_id = NULL, active = false WHERE id = $1`, [emp.id]);
});

// ───────────── Importação ─────────────
await check('importação de produtos: confere sem gravar, grava, cria categoria e dá entrada no estoque; de novo só atualiza', async () => {
  const rows = [
    { Nome: `Pasta de amendoim ${tag}`, 'Código': `IMP${tag}`, Categoria: `Importados ${tag}`, 'Preço': '29,90', 'Preço Membro': '26,90', Custo: '15,00', Estoque: '7' },
    { Nome: `Sem preço válido ${tag}`, 'Preço': '10,00', 'Preço Membro': '12,00' },
  ];
  const conf = ok(await call('/import', { ...T, method: 'POST', body: { kind: 'produtos', rows, dryRun: true } }), 201);
  assert.deepEqual([conf.created, conf.errors.length, conf.errors[0].line], [1, 1, 3]);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM product WHERE sku = $1`, [`IMP${tag}`])).rows[0].n, 0);
  const grav = ok(await call('/import', { ...T, method: 'POST', body: { kind: 'produtos', rows, dryRun: false } }), 201);
  assert.equal(grav.created, 1);
  const p = (await db.query(`SELECT p.id, p.price::float, p.member_price::float AS mp, c.name AS cat, (SELECT SUM(quantity)::float FROM stock_balance b WHERE b.product_id = p.id) AS q FROM product p JOIN product_category c ON c.id = p.category_id WHERE p.sku = $1`, [`IMP${tag}`])).rows[0];
  assert.deepEqual([p.price, p.mp, p.cat, p.q], [29.9, 26.9, `Importados ${tag}`, 7]);
  rows[0]['Preço'] = '31,90';
  const de_novo = ok(await call('/import', { ...T, method: 'POST', body: { kind: 'produtos', rows: [rows[0]], dryRun: false } }), 201);
  assert.deepEqual([de_novo.created, de_novo.updated], [0, 1]);
  const q = (await db.query(`SELECT price::float, (SELECT SUM(quantity)::float FROM stock_balance b WHERE b.product_id = p.id) AS q FROM product p WHERE sku = $1`, [`IMP${tag}`])).rows[0];
  assert.deepEqual([q.price, q.q], [31.9, 7]);
});
const ddd = String(Date.now()).slice(-8);
const fone1 = `279${ddd}`.slice(0, 11);
const fone2 = `278${ddd}`.slice(0, 11);
await check('importação de clientes: cria, vira membro com celular e pula quem já existe', async () => {
  const rows = [
    { nome: `Cliente Um ${tag}`, telefone: fone1, nascimento: '15/03/1990', membro: 'sim' },
    { nome: `Cliente Dois ${tag}`, telefone: fone2 },
    { nome: `Repetida ${tag}`, telefone: fone1 },
  ];
  const r = ok(await call('/import', { ...T, method: 'POST', body: { kind: 'clientes', rows, dryRun: false } }), 201);
  assert.deepEqual([r.created, r.errors.length], [2, 1]);
  const c = (await db.query(`SELECT is_member, birth_date::text FROM customer WHERE name ILIKE $1`, [`Cliente Um ${tag}`])).rows[0];
  assert.deepEqual([c.is_member, c.birth_date], [true, '1990-03-15']);
});

// ───────────── Disparos ─────────────
await check('disparo: só entra quem aceita WhatsApp, a mensagem sai personalizada e aparece no atendimento', async () => {
  await db.query(`UPDATE customer SET allow_whatsapp = false WHERE name ILIKE $1`, [`Cliente Dois ${tag}`]);
  await db.query(`UPDATE broadcast SET status = 'cancelado' WHERE status = 'enviando'`);
  // Grupo pequeno: só os dois clientes deste teste viram "aniversariantes do mês".
  await db.query(`UPDATE customer SET birth_date = NULL WHERE tenant_id = (SELECT id FROM tenant WHERE slug = $1) AND EXTRACT(MONTH FROM birth_date) = EXTRACT(MONTH FROM now()) AND name NOT ILIKE $2`, [SLUG, `%${tag}`]);
  await db.query(`UPDATE customer SET birth_date = (date_trunc('month', now()) + interval '9 days')::date WHERE name ILIKE $1`, [`Cliente % ${tag}`]);
  const segment = { kind: 'aniversariantes', days: 60 };
  const previa = ok(await call('/broadcasts/preview', { ...T, method: 'POST', body: segment }), 201);
  assert.equal(previa.count, 1);
  const b = ok(await call('/broadcasts', { ...T, method: 'POST', body: { name: `Teste ${tag}`, message: 'Oi, {nome}! Parabéns. Você tem {cashback}.', segment } }), 201);
  assert.equal(b.total, 1);
  let feito;
  for (let i = 0; i < 40 && feito?.status !== 'concluido'; i++) {
    await espera(250);
    feito = ok(await call('/broadcasts', T)).find((x) => x.id === b.id);
  }
  assert.deepEqual([feito.status, feito.sent, feito.failed], ['concluido', 1, 0]);
  const msg = (await db.query(`SELECT m.text FROM wa_message m JOIN wa_conversation c ON c.id = m.conversation_id WHERE c.phone LIKE $1 ORDER BY m.created_at DESC LIMIT 1`, [`%${fone1.slice(-8)}`])).rows[0];
  assert.equal(msg.text, 'Oi, Cliente! Parabéns. Você tem R$ 0,00.');
  assert.equal(ok(await call(`/broadcasts/${b.id}/recipients`, T))[0].status, 'enviado');
});
await check('origem dos anúncios soma cadastros e pedidos por fonte e campanha', async () => {
  await db.query(`UPDATE customer SET origin = $1 WHERE name ILIKE $2`, [JSON.stringify({ source: `insta${tag}`, campaign: 'black' }), `Cliente Um ${tag}`]);
  const r = ok(await call(`/broadcasts/ads?from=${hoje}&to=${hoje}`, T));
  const l = r.rows.find((x) => x.source === `insta${tag}`);
  assert.deepEqual([l.campaign, l.signups, l.orders], ['black', 1, 0]);
});

// ───────────── Auditoria ─────────────
await check('auditoria lista o que foi feito, filtra por onde e não abre para quem não gerencia usuários', async () => {
  const r = ok(await call(`/audit?from=${hoje}&to=${hoje}&entity=bank_line`, T));
  assert.ok(r.total >= 5 && r.rows.every((x) => x.entity === 'bank_line' && x.userName));
  assert.ok(r.entities.includes('broadcast'));
  const b = ok(await call(`/audit?from=${hoje}&to=${hoje}&q=budget`, T));
  assert.ok(b.rows.some((x) => x.action === 'budget.save'));
  ok(await call(`/audit?from=${hoje}&to=${hoje}`), 401);
});

// ───────────── Avisos e AFD ─────────────
await check('central de avisos junta o que pede atenção e some quando resolve', async () => {
  const [v] = ok(await call('/payables', { ...T, method: 'POST', body: { description: `Vencida ${tag}`, chartAccountId: despesa.id, amount: '77,00', dueDate: addDays(hoje, -3) } }), 201);
  let avisos = ok(await call('/alerts', T));
  const a = avisos.find((x) => x.key === 'pagar-atrasadas');
  assert.ok(a && a.level === 'urgente' && a.path === '/pagar', JSON.stringify(avisos));
  assert.ok(avisos.findIndex((x) => x.level === 'atencao') === -1 || avisos.findIndex((x) => x.level === 'urgente') < avisos.findIndex((x) => x.level === 'atencao'));
  const antes = Number(a.title.split(' ')[0]);
  ok(await call(`/payables/${v.id}/cancel`, { ...T, method: 'POST' }));
  avisos = ok(await call('/alerts', T));
  assert.equal(Number(avisos.find((x) => x.key === 'pagar-atrasadas')?.title.split(' ')[0] ?? 0), antes - 1);
  ok(await call('/alerts'), 401);
});
await check('AFD do ponto: leiaute da Portaria 671 (cabeçalho 302, marcação 137, trailer 64, assinatura 100)', async () => {
  await db.query(`UPDATE store SET cnpj = COALESCE(cnpj, '12345678000195') WHERE tenant_id = (SELECT id FROM tenant WHERE slug = $1)`, [SLUG]);
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM clock_record r JOIN tenant t ON t.id = r.tenant_id WHERE t.slug = $1 AND (r.at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3`, [SLUG, addDays(hoje, -400), hoje]);
  const res = await fetch(`${BASE}/hr/clock/afd?from=${addDays(hoje, -400)}&to=${hoje}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /AFD\d{17}\d{14}REP_P\.txt/);
  const linhas = Buffer.from(await res.arrayBuffer()).toString('latin1').split('\r\n');
  assert.equal(linhas.pop(), '');
  assert.equal(linhas.length, rows[0].n + 3);
  assert.equal(linhas[0].length, 302);
  assert.ok(linhas.slice(1, -2).every((l) => l.length === 137 && l[9] === '7' && /^[0-9a-f]{64}$/.test(l.slice(73))));
  assert.deepEqual([linhas.at(-2).length, Number(linhas.at(-2).slice(54, 63)), linhas.at(-1).length], [64, rows[0].n, 100]);
  assert.ok(linhas.at(-1).startsWith('ASSINATURA_DIGITAL_EM_ARQUIVO_P7S'));
  assert.equal((await fetch(`${BASE}/hr/clock/afd?from=x&to=y`, { headers: { authorization: `Bearer ${token}` } })).status, 422);
});

// ───────────── Fluxo de pessoas ─────────────
await check('fluxo de pessoas: contagem digitada e da câmera, conversão só do balcão e só nas horas contadas', async () => {
  const storeId = (await db.query(`SELECT s.id FROM store s JOIN tenant t ON t.id = s.tenant_id WHERE t.slug = $1 AND s.active ORDER BY s.created_at LIMIT 1`, [SLUG])).rows[0].id;
  const dia = addDays(hoje, -200);
  await db.query(`DELETE FROM foot_traffic WHERE store_id = $1 AND day IN ($2, $3)`, [storeId, dia, hoje]);
  ok(await call('/traffic/manual', { ...T, method: 'PUT', body: { storeId, day: dia, hours: [{ hour: 10, entries: 40 }, { hour: 11, entries: 60 }] } }));
  ok(await call('/traffic/manual', { ...T, method: 'PUT', body: { storeId, day: dia, hours: [{ hour: 11, entries: 10 }] } }));
  assert.deepEqual(ok(await call(`/traffic/day?storeId=${storeId}&day=${dia}`, T)).map((h) => h.entries), [40, 10]);
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM sale WHERE store_id = $1 AND status = 'completed' AND channel = 'loja' AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = $2 AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') IN (10, 11)`, [storeId, dia]);
  const r = ok(await call(`/traffic/report?from=${dia}&to=${dia}`, T));
  assert.deepEqual([r.totals.entries, r.totals.sales, r.peakHour, r.days.length], [50, rows[0].n, 10, 1]);
  ok(await call('/traffic/manual', { ...T, method: 'PUT', body: { storeId, day: addDays(hoje, 1), hours: [{ hour: 10, entries: 1 }] } }), 422);
  // Câmera: endereço com segredo, sem login.
  assert.match(r.webhookUrl, new RegExp(`/v1/traffic/in/${SLUG}/`));
  const url = r.webhookUrl.replace(/^https?:\/\/[^/]+\/v1/, BASE);
  assert.equal((await fetch(url.replace(/[^/]+$/, 'segredo-errado'))).status, 403);
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(`${url}?in=4&out=2`, { method: 'POST' })).status, 200);
  const cam = (await db.query(`SELECT SUM(entries)::int AS e, SUM(exits)::int AS x, MAX(source) AS s FROM foot_traffic WHERE store_id = $1 AND day = $2`, [storeId, hoje])).rows[0];
  assert.deepEqual([cam.e, cam.x, cam.s], [5, 2, 'camera']);
  ok(await call(`/traffic/report?from=${hoje}&to=${hoje}`), 401);
});

await db.end();
console.log(`\n${passed} verificações passaram.`);
