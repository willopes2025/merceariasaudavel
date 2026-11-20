# Publicar o VISIO em programaseven.wideic.com

O VISIO roda na **mesma VPS do Soul ERP** (Hostinger, 179.199.139.101), com
banco próprio, e usa o **Caddy que já existe lá** para o HTTPS. Nada do Soul
ERP nem do Martins Auto Peças é recriado ou reiniciado: só se acrescenta um
bloco ao Caddyfile e recarrega.

| Peça | Onde |
|---|---|
| Sistema + API | contêiner `visio-app` (porta 3000, só na rede Docker) |
| Banco | contêiner `visio-db` (PostgreSQL 16, volume `visio_pgdata`, só na rede interna) |
| HTTPS | Caddy do Soul ERP, bloco `programaseven.wideic.com` |
| Código | `/opt/visio` (repositório willopes2025/visio) |

Todos os comandos abaixo são na VPS, como root (terminal do hPanel ou
`ssh root@179.199.139.101`).

## 1. Conferir o DNS

```bash
getent ahostsv4 programaseven.wideic.com | head -n1   # tem que mostrar 179.199.139.101
```

Se não mostrar, espere a propagação: o certificado só sai com o DNS no lugar.

## 2. Conferir memória e a rede do Soul

```bash
free -h                                   # o VISIO usa até ~1,5 GB (app + banco)
docker network ls | grep -i erp           # anote o nome (normalmente erp_default)
docker ps --format '{{.Names}}\t{{.Networks}}' | grep -i proxy   # o Caddy tem que estar nessa rede
```

## 3. Baixar o código

O repositório é privado. A VPS acessa o GitHub por chave SSH (a mesma do Soul
ERP). Tente primeiro:

```bash
git clone git@github.com:willopes2025/mercearia.git /opt/visio
cd /opt/visio
```

Se der `Permission denied` ou `Repository not found`, a chave da VPS é uma
"deploy key" só do repositório do Soul. Crie uma chave para o VISIO:

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/visio_deploy -C "vps-visio"
cat >> ~/.ssh/config <<'CFG'
Host github-visio
  HostName github.com
  User git
  IdentityFile ~/.ssh/visio_deploy
  IdentitiesOnly yes
CFG
cat ~/.ssh/visio_deploy.pub
```

Copie a linha que aparecer e cadastre em **github.com/willopes2025/visio ›
Settings › Deploy keys › Add deploy key** (só leitura). Depois:

```bash
git clone git@github-visio:willopes2025/mercearia.git /opt/visio
cd /opt/visio
```

## 4. Configurar o `.env`

```bash
cp .env.production.example .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
# Se a rede do passo 2 não for erp_default, corrija SOUL_NETWORK:
nano .env
```

## 5. Subir o VISIO

O build demora alguns minutos na primeira vez.

```bash
nohup docker compose -f docker-compose.prod.yml up -d --build > /root/visio-deploy.log 2>&1 &
tail -f /root/visio-deploy.log          # Ctrl+C quando terminar
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec visio-app curl -fsS http://127.0.0.1:3000/v1/health
```

Criar a organização, as lojas, as operações e o seu acesso de proprietário
(troque o e-mail e a senha):

```bash
docker compose -f docker-compose.prod.yml exec \
  -e SEED_ADMIN_EMAIL=seu-email@dominio.com \
  -e SEED_ADMIN_PASSWORD='uma-senha-forte' \
  -e SEED_ADMIN_NAME='Wil' \
  visio-app node apps/api/prisma/seed.mjs
```

O seed pode rodar de novo sem problema: só cria o que falta.

## 6. Acrescentar o domínio ao Caddy do Soul ERP

O Caddyfile do Soul é montado como arquivo único: editar com `sed -i` troca o
arquivo e o contêiner não vê a mudança. Por isso o acréscimo é por `cat >>`.
**Não** rode `git checkout`/`git reset` na pasta do Soul: os blocos do Martins
só existem no Caddyfile do servidor.

```bash
cd /opt/soul-erp/erp
cp Caddyfile "Caddyfile.backup-$(date +%Y%m%d%H%M)"
cat >> Caddyfile <<'EOF'

# VISIO (ERP de ótica + CRM) — contêiner visio-app, projeto em /opt/visio
programaseven.wideic.com {
	encode gzip zstd

	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
	}

	reverse_proxy visio-app:3000
}
EOF
docker compose -f docker-compose.prod.yml exec proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -f docker-compose.prod.yml exec proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Se o `validate` reclamar, volte o backup (`cat Caddyfile.backup-AAAAMMDDHHMM > Caddyfile`)
antes do `reload`: os outros sites continuam no ar.

## 7. Conferir

```bash
curl -fsS https://programaseven.wideic.com/v1/health
```

Abra https://programaseven.wideic.com e entre com o e-mail e a senha do passo 5.

## 8. Backup diário

```bash
cd /opt/visio
./scripts/backup.sh                       # testa agora
(crontab -l 2>/dev/null; echo "0 3 * * * cd /opt/visio && ./scripts/backup.sh >> backups/backup.log 2>&1") | crontab -
```

## 9. Ligar a carga do ssÓtica (uma vez)

Peça o token de integração ao suporte do ssÓtica e acrescente ao `/opt/visio/.env`
(com `nano .env`):

```
SSOTICA_TOKEN=cole-o-token-aqui
SSOTICA_CNPJ=00000000000000      # CNPJ da loja no ssÓtica, só números
# ou, se o ssÓtica identificar por empresa:
# SSOTICA_EMPRESA=123
```

Depois recrie o contêiner para ler o `.env` novo:

```bash
cd /opt/visio
docker compose -f docker-compose.prod.yml up -d visio-app
```

No VISIO: **Configurações → Importar do ssÓtica**. Rode primeiro a **simulação**
(não grava nada), confira o relatório e só então a importação real. A planilha
exportada do ssÓtica (.xlsx ou .csv) também pode ser enviada na mesma tela.

## 10. WhatsApp (por enquanto: não fazer nada)

O VISIO **ainda não tem WhatsApp próprio**; ele entra na Fase 6. Até lá o envio
fica desligado: nenhuma mensagem sai, a tela não mostra o botão de enviar e a
O.S. registra os avisos como "não enviada". **Não precisa configurar nada.**

O VISIO **não usa o Widezap**. Se existir alguma linha `WIDEZAP_...` no `.env`,
apague:

```bash
cd /opt/visio && sed -i '/^WIDEZAP_/d' .env
```

Só se um dia quiser adiantar os avisos: `WHATSAPP_WEBHOOK_URL` aceita a URL
https de um serviço que receba `POST {"phone","message"}`. Nunca cole texto de
exemplo nessa variável; valor inválido é ignorado e o envio continua desligado.

## 11. Ligar o Asaas (crediário com boleto)

Sem isto o crediário já funciona, só que sem boleto (parcelas recebidas na loja).
Comece pelo ambiente de testes do Asaas (sandbox); só troque para a conta real
depois de conferir um boleto de teste.

1. No Asaas: **Integrações → Chaves de API**, gere uma chave.
2. Gere o segredo do aviso de pagamento: `openssl rand -hex 24`
3. No `/opt/visio/.env` (a chave entre **aspas simples**, porque começa com `$`):

```
ASAAS_API_KEY='$aact_...'
ASAAS_ENV=sandbox
ASAAS_WEBHOOK_TOKEN=o-valor-gerado-no-passo-2
```

   Para a conta real: `ASAAS_ENV=production` e a chave de produção.
4. `docker compose -f docker-compose.prod.yml up -d visio-app`
5. No Asaas: **Integrações → Webhooks → novo webhook**
   - URL: `https://programaseven.wideic.com/v1/public/asaas/webhook`
   - Token de autenticação: o mesmo valor do passo 2
   - Eventos: cobranças (pelo menos "Cobrança recebida" e "Cobrança confirmada")
6. Confira: `curl -s https://programaseven.wideic.com/v1/health/features` deve
   mostrar `"asaas":true`.

Multa e juros de atraso são os configurados na própria conta Asaas; o VISIO não
manda outros valores. O Asaas não envia e-mail nem SMS aos clientes criados pelo VISIO.

## 12. Ligar a nota fiscal (NFC-e pela Focus NFe)

Nada disso mexe no servidor: é tudo pela tela, em **Configurações → Fiscal**.

1. No painel da Focus NFe, cadastre cada empresa (CNPJ), envie o certificado digital A1 e informe o CSC da NFC-e.
2. No VISIO, em **Configurações → Lojas**, preencha o CNPJ de cada loja.
3. Em **Configurações → Fiscal → Configurar**, cole o token de **homologação** da empresa, marque "Emitir nota fiscal nesta loja" e salve. Use "Testar token salvo".
4. Abra uma O.S. e clique em **Emitir NFC-e**. Em homologação a nota é de teste.
5. Com a nota de teste autorizada e a tributação conferida pela contabilidade, cole o token de **produção** e mude o ambiente.

Os tokens ficam cifrados no banco com uma chave derivada do `JWT_SECRET`. Se o `JWT_SECRET` for trocado, cole os tokens de novo.

## Atualizar depois (cada nova entrega)

Um comando só:

```bash
cd /opt/visio && ./scripts/atualizar.sh
```

Ele faz o backup, baixa o código, reconstrói, espera o sistema subir, roda o seed
e mostra a versão no ar. As migrações do banco rodam sozinhas na subida.

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| `network erp_default declared as external, but could not be found` | Corrija `SOUL_NETWORK` no `.env` com o nome do passo 2 |
| Site abre o Soul ERP ou dá 502 | `docker network inspect <rede> \| grep visio-app` — o contêiner tem que estar na rede do Caddy |
| `JWT_SECRET ausente ou curto` nos logs | Rode de novo o `sed` do passo 4 e suba outra vez |
| Ver os logs | `docker compose -f docker-compose.prod.yml logs -f visio-app` |
| Voltar o isolamento do banco sem deploy | `DB_ISOLATION=off` no `.env` e `up -d visio-app` |
