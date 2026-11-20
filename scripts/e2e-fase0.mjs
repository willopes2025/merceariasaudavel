// Teste ponta a ponta da Fase 0, contra a API rodando e o banco de verdade.
//
//   E2E_BASE=http://localhost:3000 E2E_DATABASE_URL=postgresql://... \
//   E2E_EMAIL=... E2E_PASSWORD=... node scripts/e2e-fase0.mjs
//
// Cria dados de teste com sufixo único (não apaga nada de quem já usa).
// Confere: login e bloqueio, permissões por papel, lojas por pessoa,
// desativação imediata, proteções (próprio acesso, último proprietário,
// escalada de papel), auditoria e isolamento entre organizações no banco.

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const pg = require('pg');
const argon2 = require('argon2');

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
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function login(email, password) {
  const r = await call('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200, `login de ${email}: ${JSON.stringify(r.body)}`);
  return r.body.accessToken;
}

async function check(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const db = new pg.Client({ connectionString: DB });
await db.connect();

console.log('Mercearia · Acesso e lojas · ponta a ponta');

const owner = await login(OWNER.email, OWNER.password);
const me = (await call('/auth/me', { token: owner })).body;
const stores = (await call('/stores', { token: owner })).body;
const jj = stores.find((s) => s.code === 'loja');

await check('saúde e login do proprietário', async () => {
  assert.equal((await call('/health')).status, 200);
  assert.ok(me.permissions.includes('*'));
  assert.ok(jj, 'loja do seed');
});

await check('senha errada não diz se o e-mail existe', async () => {
  const a = await call('/auth/login', { method: 'POST', body: { email: OWNER.email, password: 'errada-123' } });
  const b = await call('/auth/login', { method: 'POST', body: { email: `ninguem-${tag}@x.com`, password: 'errada-123' } });
  assert.equal(a.status, 401);
  assert.equal(a.body.error.message, b.body.error.message);
});

await check('sem token, nada abre', async () => {
  assert.equal((await call('/stores')).status, 401);
});

await check('loja: cria, recusa código repetido, valida CNPJ', async () => {
  const r = await call('/stores', { token: owner, method: 'POST', body: { code: `teste-${tag}`, name: `Loja teste ${tag}`, cnpj: '12.345.678/0001-90' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.cnpj, '12345678000190');
  const dup = await call('/stores', { token: owner, method: 'POST', body: { code: `teste-${tag}`, name: 'Outra' } });
  assert.equal(dup.status, 409);
  const bad = await call('/stores', { token: owner, method: 'POST', body: { code: `x-${tag}`, name: 'X', cnpj: '123' } });
  assert.equal(bad.status, 400);
});

const sellerEmail = `vendedor-${tag}@teste.local`;
let seller;
let sellerId;
await check('atendente só na loja dela', async () => {
  const r = await call('/users', {
    token: owner,
    method: 'POST',
    body: { name: 'Vendedor Teste', email: sellerEmail, password: 'senha-vendedor', roleCode: 'seller', storeIds: [jj.id] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  sellerId = r.body.id;
  seller = await login(sellerEmail, 'senha-vendedor');
  const sme = (await call('/auth/me', { token: seller })).body;
  assert.deepEqual(sme.storeIds, [jj.id]);
  assert.ok(!sme.permissions.includes('settings.manage'));
});

await check('vendedor não configura loja nem vê usuários', async () => {
  assert.equal((await call('/stores', { token: seller })).status, 200);
  assert.equal((await call('/stores', { token: seller, method: 'POST', body: { code: `v-${tag}`, name: 'V' } })).status, 403);
  assert.equal((await call('/users', { token: seller })).status, 403);
});

const managerEmail = `gerente-${tag}@teste.local`;
let manager;
await check('gerente não se promove nem mexe no proprietário', async () => {
  const r = await call('/users', {
    token: owner,
    method: 'POST',
    body: { name: 'Gerente Teste', email: managerEmail, password: 'senha-gerente', roleCode: 'store_manager', storeIds: [] },
  });
  assert.equal(r.status, 201);
  manager = await login(managerEmail, 'senha-gerente');
  const promote = await call('/users', {
    token: manager,
    method: 'POST',
    body: { name: 'Novo dono', email: `dono-${tag}@teste.local`, password: 'senha-dono-1', roleCode: 'owner', storeIds: [] },
  });
  assert.equal(promote.status, 403);
  assert.equal(promote.body.error.code, 'GRANT_DENIED');
  const touchOwner = await call(`/users/${me.id}`, {
    token: manager,
    method: 'PUT',
    body: { name: me.name, email: me.email, roleCode: 'owner', storeIds: [], active: false },
  });
  assert.equal(touchOwner.status, 403);
  // Mas o gerente cadastra vendedor normalmente.
  const ok = await call('/users', {
    token: manager,
    method: 'POST',
    body: { name: 'Caixa Teste', email: `caixa-${tag}@teste.local`, password: 'senha-caixa1', roleCode: 'cashier', storeIds: [jj.id] },
  });
  assert.equal(ok.status, 201);
});

await check('ninguém desativa o próprio acesso', async () => {
  const r = await call(`/users/${me.id}`, {
    token: owner,
    method: 'PUT',
    body: { name: me.name, email: me.email, roleCode: 'owner', storeIds: [], active: false },
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, 'SELF_LOCKOUT');
});

await check('desativar vale na hora, mesmo com o token ainda válido', async () => {
  const r = await call(`/users/${sellerId}`, {
    token: owner,
    method: 'PUT',
    body: { name: 'Vendedor Teste', email: sellerEmail, roleCode: 'seller', storeIds: [jj.id], active: false },
  });
  assert.equal(r.status, 200);
  assert.equal((await call('/stores', { token: seller })).status, 401);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: sellerEmail, password: 'senha-vendedor' } })).status, 401);
});

await check('auditoria registrou as mudanças', async () => {
  const { rows } = await db.query(
    `SELECT action FROM audit_log WHERE tenant_id = $1 AND created_at > now() - interval '5 minutes'`,
    [me.tenantId],
  );
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ['store.create', 'user.create', 'user.update']) assert.ok(actions.has(a), `falta ${a}`);
});

// --------------------------------------------------------- isolamento entre organizações
const other = await db.query(`INSERT INTO tenant (id, name) VALUES (gen_random_uuid()::text, $1) RETURNING id`, [`Outra ótica ${tag}`]);
const otherId = other.rows[0].id;
await db.query(`INSERT INTO store (id, tenant_id, code, name) VALUES (gen_random_uuid()::text, $1, 'loja-x', 'Loja da outra ótica')`, [otherId]);
const ownerRole = await db.query(`SELECT id FROM role WHERE tenant_id IS NULL AND code = 'owner'`);
const otherEmail = `dono-${tag}@outra.local`;
await db.query(
  `INSERT INTO app_user (id, tenant_id, name, email, password_hash, role_id) VALUES (gen_random_uuid()::text, $1, 'Dono da outra', $2, $3, $4)`,
  [otherId, otherEmail, await argon2.hash('senha-da-outra'), ownerRole.rows[0].id],
);

await check('outra organização não vê as lojas do grupo (API)', async () => {
  const t = await login(otherEmail, 'senha-da-outra');
  const r = await call('/stores', { token: t });
  assert.deepEqual(r.body.map((s) => s.name), ['Loja da outra ótica']);
  const edit = await call(`/stores/${jj.id}`, { token: t, method: 'PUT', body: { code: 'invadida', name: 'Invadida' } });
  assert.equal(edit.status, 404);
});

await check('o banco barra mesmo consulta sem filtro (RLS)', async () => {
  await db.query('BEGIN');
  try {
    await db.query(`SELECT set_config('role', 'mercearia_app', true), set_config('app.tenant_ids', $1, true), set_config('app.tenant_id', $1, true)`, [me.tenantId]);
    const seen = await db.query(`SELECT count(*)::int AS n FROM store WHERE tenant_id = $1`, [otherId]);
    assert.equal(seen.rows[0].n, 0, 'enxergou loja de outra organização');
    const users = await db.query(`SELECT count(*)::int AS n FROM app_user WHERE tenant_id = $1`, [otherId]);
    assert.equal(users.rows[0].n, 0);
    await assert.rejects(
      db.query(`INSERT INTO store (id, tenant_id, code, name) VALUES (gen_random_uuid()::text, $1, 'intrusa', 'Intrusa')`, [otherId]),
      /row-level security/,
    );
  } finally {
    await db.query('ROLLBACK');
  }
  await db.query('BEGIN');
  try {
    await db.query(`SELECT set_config('role', 'mercearia_app', true), set_config('app.tenant_ids', $1, true), set_config('app.tenant_id', $1, true)`, [me.tenantId]);
    await assert.rejects(db.query(`UPDATE audit_log SET action = 'apagado'`), /permission denied/);
  } finally {
    await db.query('ROLLBACK');
  }
});

await check('cinco senhas erradas bloqueiam o e-mail por 15 minutos', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call('/auth/login', { method: 'POST', body: { email: otherEmail, password: 'errada-xyz' } });
  assert.equal(last.status, 429);
  assert.equal(last.body.error.code, 'LOGIN_LOCKED');
});

await db.end();
console.log(`\n${passed} verificações passaram.`);
