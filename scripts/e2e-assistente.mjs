// Teste ponta a ponta do Assistente (sem chamar a IA): estado, conversas, anexos guardados no banco,
// configuração por empresa, rotinas, pedidos e permissões (atendente não usa; gerente usa; dono configura).
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
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, body: type.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer()) };
}
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const ok = (r) => {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const login = async (email, password) => ok(await call('/auth/login', { method: 'POST', body: { email, password } })).accessToken;

console.log('Assistente');
const owner = await login(OWNER.email, OWNER.password);
const stores = ok(await call('/stores', { token: owner }));

await check('estado: ferramentas conforme as permissões do dono', async () => {
  const e = ok(await call('/assistant/state', { token: owner }));
  assert.equal(typeof e.ligado, 'boolean');
  assert.ok(e.podeConfigurar);
  for (const f of ['consultar_dados', 'resumo_negocio', 'alertas_estoque', 'criar_campanha', 'alterar_preco', 'agendar_rotina']) assert.ok(e.ferramentas.some((x) => x.nome === f), f);
});

let sessao;
await check('conversa: cria, abre, muda aprovação e exclui', async () => {
  sessao = ok(await call('/assistant/sessions', { token: owner, method: 'POST', body: {} }));
  assert.equal(sessao.titulo, 'Nova conversa');
  const s = ok(await call(`/assistant/sessions/${sessao.id}`, { token: owner }));
  assert.deepEqual(s.mensagens, []);
  assert.equal(ok(await call(`/assistant/sessions/${sessao.id}`, { token: owner, method: 'PATCH', body: { aprovacao: 'automatico' } })).aprovacao, 'automatico');
  assert.ok(ok(await call('/assistant/sessions', { token: owner })).some((x) => x.id === sessao.id));
});

await check('mensagem vazia é recusada', async () => {
  assert.equal((await call(`/assistant/sessions/${sessao.id}/messages`, { token: owner, method: 'POST', body: { texto: '' } })).status, 400);
});

await check('anexo: CSV vira texto, fica no banco e só quem anexou baixa', async () => {
  const csv = 'produto;quantidade\nWhey;3\n';
  const a = ok(await call('/assistant/attachments', { token: owner, method: 'POST', body: { nome: `lista-${tag}.csv`, mime: 'text/csv', conteudo: Buffer.from(csv).toString('base64') } }));
  assert.equal(a.leitura, 'texto extraído');
  const d = await call(`/assistant/attachments/${a.id}`, { token: owner });
  assert.equal(d.status, 200);
  assert.equal(d.body.toString(), csv);
  assert.equal((await call('/assistant/attachments', { token: owner, method: 'POST', body: { nome: 'x.exe', mime: 'application/x-msdownload', conteudo: 'AAAA' } })).status, 400);
});

await check('configuração por empresa: salva e volta', async () => {
  const c = ok(await call('/assistant/config', { token: owner }));
  assert.ok(c.opcoes.openai.length > 0);
  const novo = { nome: `Sol ${tag}`.slice(0, 40), instrucoes: 'Nunca dê desconto acima de 15%.', voz: 'automatica', aprovacaoAutomatica: 'gestao', vozElevenlabs: c.vozElevenlabs, vozOpenai: c.vozOpenai };
  ok(await call('/assistant/config', { token: owner, method: 'PUT', body: novo }));
  assert.equal(ok(await call('/assistant/state', { token: owner })).nome, novo.nome);
  ok(await call('/assistant/config', { token: owner, method: 'PUT', body: { ...novo, nome: c.nome, instrucoes: c.instrucoes } }));
  assert.equal((await call('/assistant/config', { token: owner, method: 'PUT', body: { ...novo, nome: 'x' } })).status, 400);
});

await check('rotinas e pedidos: listas do usuário', async () => {
  assert.ok(Array.isArray(ok(await call('/assistant/routines', { token: owner }))));
  assert.ok(Array.isArray(ok(await call('/assistant/requests', { token: owner }))));
  assert.equal((await call('/assistant/routines/00000000-0000-4000-8000-000000000000/run', { token: owner, method: 'POST', body: {} })).status, 404);
});

await check('atendente não usa o Assistente; gerente usa mas não configura', async () => {
  const mk = async (roleCode) => {
    const email = `${roleCode}-assist-${tag}@teste.local`;
    ok(await call('/users', { token: owner, method: 'POST', body: { name: `Teste ${roleCode}`, email, password: 'senha-teste-123', roleCode, storeIds: [stores[0].id] } }));
    return login(email, 'senha-teste-123');
  };
  const seller = await mk('seller');
  assert.equal((await call('/assistant/state', { token: seller })).status, 403);
  assert.equal((await call('/assistant/sessions', { token: seller, method: 'POST', body: {} })).status, 403);
  const manager = await mk('store_manager');
  const e = ok(await call('/assistant/state', { token: manager }));
  assert.equal(e.podeConfigurar, false);
  assert.equal((await call('/assistant/config', { token: manager })).status, 403);
  // A conversa do dono não aparece para o gerente.
  assert.equal((await call(`/assistant/sessions/${sessao.id}`, { token: manager })).status, 404);
});

await check('excluir a conversa', async () => {
  ok(await call(`/assistant/sessions/${sessao.id}`, { token: owner, method: 'DELETE' }));
  assert.equal((await call(`/assistant/sessions/${sessao.id}`, { token: owner })).status, 404);
});

console.log(`\n${passed} verificações do Assistente passaram.`);
