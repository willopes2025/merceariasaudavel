// Teste ponta a ponta do atendimento no WhatsApp com o provedor de teste (nada sai para fora):
// entrada pelo webhook (com segredo e sem duplicar), conversa ligada à cliente, resposta da equipe,
// falha de envio, produto e carrinho por link, resolver/reabrir, eco do celular e permissões.
// Rode a API com WHATSAPP_PROVIDER=teste e WHATSAPP_INBOUND_SECRET (padrão segredo-local-123).
import assert from 'node:assert/strict';

const BASE = (process.env.E2E_BASE ?? 'http://localhost:3000') + '/v1';
const SLUG = process.env.E2E_SLUG ?? 'mercearia-saudavel';
const SEGREDO = process.env.E2E_WA_SECRET ?? 'segredo-local-123';
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
const login = async (email, password) => ok(await call('/auth/login', { method: 'POST', body: { email, password } })).accessToken;
const entra = (msg) => call(`/whatsapp/in/${SLUG}/${SEGREDO}`, { method: 'POST', body: msg });

console.log('WhatsApp');
const owner = await login(OWNER.email, OWNER.password);
const status = ok(await call('/whatsapp/status', { token: owner }));
if (status.provedor !== 'teste') {
  console.log('  (pulado: a API não está com WHATSAPP_PROVIDER=teste)');
  process.exit(0);
}
const stores = ok(await call('/stores', { token: owner }));
const local = `279${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const fone = `55${local}`;
const cliente = ok(await call('/customers', { token: owner, method: 'POST', body: { name: `Wa Cliente ${tag}`, phone: local, isMember: true } }), 201);
let conversa;

await check('entrada: segredo errado é recusado, mensagem nova cria conversa ligada à cliente', async () => {
  assert.equal((await call(`/whatsapp/in/${SLUG}/errado`, { method: 'POST', body: {} })).status, 403);
  ok(await entra({ phone: fone, name: 'Apelido', message: 'Oi! Tem pacco de frango?', id: `e2e-${tag}-1` }));
  const lista = ok(await call(`/whatsapp/conversations?busca=${local.slice(-8)}`, { token: owner }));
  assert.equal(lista.length, 1);
  conversa = lista[0];
  assert.equal(conversa.customerId, cliente.id);
  assert.equal(conversa.unread, 1);
  assert.equal(conversa.name, cliente.name);
});

await check('mesma mensagem reenviada pelo provedor não duplica', async () => {
  assert.equal(ok(await entra({ phone: fone, message: 'Oi! Tem pacco de frango?', id: `e2e-${tag}-1` })).recebidas, 0);
  const c = ok(await call(`/whatsapp/conversations/${conversa.id}`, { token: owner }));
  assert.equal(c.messages.filter((m) => m.author === 'cliente').length, 1);
  assert.equal(c.customer.id, cliente.id);
  assert.equal(ok(await call(`/whatsapp/conversations?busca=${local.slice(-8)}`, { token: owner }))[0].unread, 0);
});

await check('equipe responde: sai pelo canal, aparece na conversa e a IA pausa', async () => {
  ok(await call(`/whatsapp/conversations/${conversa.id}/messages`, { token: owner, method: 'POST', body: { texto: 'Tem sim! Quer que eu separe?' } }));
  const c = ok(await call(`/whatsapp/conversations/${conversa.id}`, { token: owner }));
  const m = c.messages.at(-1);
  assert.equal(m.author, 'equipe');
  assert.equal(m.status, 'enviada');
  assert.ok(m.userName);
  assert.equal(c.aiEnabled, false);
  ok(await call(`/whatsapp/conversations/${conversa.id}`, { token: owner, method: 'PATCH', body: { aiEnabled: true } }));
});

await check('falha de envio fica marcada na conversa', async () => {
  const r = await call(`/whatsapp/conversations/${conversa.id}/messages`, { token: owner, method: 'POST', body: { texto: 'teste [falhar]' } });
  assert.equal(r.status, 400);
  const m = ok(await call(`/whatsapp/conversations/${conversa.id}`, { token: owner })).messages.at(-1);
  assert.equal(m.status, 'falhou');
  assert.ok(m.error);
});

await check('produto e carrinho por link: a loja online recebe os itens', async () => {
  const cat = ok(await call(`/shop/${SLUG}/catalog`));
  const p = cat.products.find((x) => x.available && !x.optionGroups.length);
  assert.ok(p, 'precisa de um produto disponível no app');
  ok(await call(`/whatsapp/conversations/${conversa.id}/product`, { token: owner, method: 'POST', body: { productId: p.id } }));
  const r = ok(await call(`/whatsapp/conversations/${conversa.id}/cart`, { token: owner, method: 'POST', body: { itens: [{ productId: p.id, quantity: 3 }] } }));
  const codigo = new URL(r.link).searchParams.get('c');
  assert.ok(codigo);
  const loja = ok(await call(`/shop/${SLUG}/wa-carts/${codigo}`));
  assert.deepEqual(loja.items, [{ productId: p.id, quantity: 3 }]);
  assert.equal((await call(`/shop/${SLUG}/wa-carts/naoexiste123`)).status, 404);
  const msgs = ok(await call(`/whatsapp/conversations/${conversa.id}`, { token: owner })).messages;
  assert.ok(msgs.at(-1).text.includes(r.link));
  assert.ok(msgs.at(-2).text.includes(p.name));
});

await check('resolver e reabrir quando a cliente volta a escrever', async () => {
  ok(await call(`/whatsapp/conversations/${conversa.id}`, { token: owner, method: 'PATCH', body: { status: 'resolvida', assumir: true } }));
  assert.ok(!ok(await call('/whatsapp/conversations?filtro=abertas', { token: owner })).some((c) => c.id === conversa.id));
  assert.ok(ok(await call('/whatsapp/conversations?filtro=resolvidas', { token: owner })).some((c) => c.id === conversa.id));
  ok(await entra({ phone: fone, message: 'Obrigada!', id: `e2e-${tag}-2` }));
  const c = ok(await call(`/whatsapp/conversations/${conversa.id}`, { token: owner }));
  assert.equal(c.status, 'aberta');
  assert.ok(ok(await call('/whatsapp/conversations?filtro=minhas', { token: owner })).some((x) => x.id === conversa.id));
});

await check('resposta pelo celular da loja entra como equipe e pausa a IA', async () => {
  ok(await entra({ phone: fone, message: 'Respondi pelo celular', id: `e2e-${tag}-3`, fromMe: true }));
  const c = ok(await call(`/whatsapp/conversations/${conversa.id}`, { token: owner }));
  assert.equal(c.messages.at(-1).author, 'equipe');
  assert.equal(c.messages.at(-1).direction, 'out');
  assert.equal(c.aiEnabled, false);
});

await check('conversa nova com celular de quem nunca escreveu', async () => {
  const r = ok(await call('/whatsapp/conversations', { token: owner, method: 'POST', body: { phone: `(27) 9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } }));
  const c = ok(await call(`/whatsapp/conversations/${r.id}`, { token: owner }));
  assert.equal(c.messages.length, 0);
  assert.equal((await call('/whatsapp/conversations', { token: owner, method: 'POST', body: { phone: '123' } })).status, 400);
});

await check('permissões: atendente responde, preparo não vê, só a gestão configura a IA', async () => {
  const mk = async (roleCode) => {
    const email = `${roleCode}-wa-${tag}@teste.local`;
    ok(await call('/users', { token: owner, method: 'POST', body: { name: `Teste ${roleCode}`, email, password: 'senha-teste-123', roleCode, storeIds: [stores[0].id] } }));
    return login(email, 'senha-teste-123');
  };
  const seller = await mk('seller');
  ok(await call(`/whatsapp/conversations/${conversa.id}/messages`, { token: seller, method: 'POST', body: { texto: 'Oi, aqui é da loja!' } }));
  assert.equal((await call('/whatsapp/config', { token: seller })).status, 403);
  const kitchen = await mk('kitchen');
  assert.equal((await call('/whatsapp/conversations', { token: kitchen })).status, 403);
  const cfg = ok(await call('/whatsapp/config', { token: owner }));
  ok(await call('/whatsapp/config', { token: owner, method: 'PUT', body: { ...cfg, instrucoes: 'Teste e2e' } }));
  assert.equal(ok(await call('/whatsapp/config', { token: owner })).instrucoes, 'Teste e2e');
  ok(await call('/whatsapp/config', { token: owner, method: 'PUT', body: cfg }));
});

console.log(`\n${passed} verificações do WhatsApp passaram.`);
