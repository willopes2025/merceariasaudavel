# Publicar a Mercearia Saudável em mercearia.wideic.com

Roda na **mesma VPS do Soul ERP, do VISIO e da Aritana** (Hostinger, 179.199.139.101),
com banco próprio e atrás do mesmo Caddy.

| O quê | Onde |
|---|---|
| Sistema + API | contêiner `mercearia-app` (porta 3000, só na rede Docker) |
| Banco | contêiner `mercearia-db` (PostgreSQL 16, volume `mercearia_pgdata`, só na rede interna) |
| Código | `/opt/mercearia` (repositório willopes2025/merceariasaudavel) |
| Domínio | mercearia.wideic.com → Caddy do Soul ERP |

Todos os comandos abaixo são no terminal do hPanel da Hostinger (como root).

## 1. DNS

No painel DNS da Hostinger, registro **A**: nome `mercearia`, valor `179.199.139.101`.
Confira antes de seguir: `dig +short mercearia.wideic.com` tem que responder o IP da VPS.

## 2. Memória

```bash
free -h        # a Mercearia usa até ~1,5 GB (app + banco)
```

## 3. Baixar o código (chave de deploy só deste repositório)

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/mercearia_deploy -C "vps-mercearia"
cat >> ~/.ssh/config <<'CFG'
Host github-mercearia
  HostName github.com
  User git
  IdentityFile ~/.ssh/mercearia_deploy
  IdentitiesOnly yes
CFG
cat ~/.ssh/mercearia_deploy.pub
```

Copie a linha que aparecer e cadastre em **github.com/willopes2025/merceariasaudavel ›
Settings › Deploy keys › Add deploy key** (só leitura). Depois:

```bash
git clone git@github-mercearia:willopes2025/merceariasaudavel.git /opt/mercearia
cd /opt/mercearia
```

## 4. Configurar

```bash
cp .env.production.example .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
docker network ls | grep -i erp      # confira o nome da rede do Soul (padrão: erp_default)
```

Se a rede do Soul tiver outro nome, ajuste `SOUL_NETWORK=` no `.env`.

## 5. Subir

```bash
nohup docker compose -f docker-compose.prod.yml up -d --build > /root/mercearia-deploy.log 2>&1 &
tail -f /root/mercearia-deploy.log          # Ctrl+C quando terminar
docker compose -f docker-compose.prod.yml exec mercearia-app curl -fsS http://127.0.0.1:3000/v1/health
```

Criar a loja e o usuário da dona (troque e-mail, senha e nome):

```bash
docker compose -f docker-compose.prod.yml exec \
  -e SEED_ADMIN_EMAIL=EMAIL_DA_DONA -e SEED_ADMIN_PASSWORD='SENHA_FORTE' -e SEED_ADMIN_NAME='NOME' \
  mercearia-app node apps/api/prisma/seed.mjs
```

## 6. Acrescentar o domínio ao Caddy do Soul ERP

O Caddyfile do Soul é montado como arquivo único: editar com `sed -i` troca o
arquivo e o contêiner não vê a mudança. Por isso o acréscimo é por `cat >>`.
**Não** rode `git checkout`/`git reset` na pasta do Soul: os blocos do Martins
só existem no Caddyfile do servidor.

```bash
cd /opt/soul-erp/erp
cp Caddyfile "Caddyfile.backup-$(date +%Y%m%d%H%M)"
cat >> Caddyfile <<'CADDY'

# Mercearia Saudável — contêiner mercearia-app, projeto em /opt/mercearia
mercearia.wideic.com {
	encode gzip zstd

	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
	}

	reverse_proxy mercearia-app:3000
}
CADDY
docker compose -f docker-compose.prod.yml exec proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -f docker-compose.prod.yml exec proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Se o `validate` reclamar, volte o backup (`cat Caddyfile.backup-AAAAMMDDHHMM > Caddyfile`)
antes do `reload`: os outros sites continuam no ar.

## 7. Conferir

```bash
curl -fsS https://mercearia.wideic.com/v1/health
```

Abra https://mercearia.wideic.com e entre com o e-mail e a senha do passo 5.

## 8. Backup diário

```bash
cd /opt/mercearia
(crontab -l 2>/dev/null; echo "15 3 * * * cd /opt/mercearia && ./scripts/backup.sh >> backups/backup.log 2>&1") | crontab -
```

## 9. Primeiros cadastros (na tela)

1. **Configurações › Loja**: nome e CNPJ.
2. **Configurações › Clube e cashback**: % de cashback, validade e limite de uso.
3. **Configurações › Categorias** e **Produtos**: preço, preço de membro, código de barras, lote/validade.
4. Insumos (tipo *Insumo*) e os shakes/sorvetes (tipo *Preparado*) com a **ficha técnica**.
5. **Configurações › Usuários**: equipe (Caixa, Atendente, Preparo, Gerente).
6. **Metas** e **Configurações › Telas de TV** (o link vai na TV box).
7. **Configurações › Nota fiscal**: token da Focus NFe (comece em homologação).

## 10. TV da loja

Em **Configurações › Telas de TV** crie a tela e copie o link. Na TV box (Android TV)
instale um navegador de quiosque que abra uma página ao ligar (ex.: Fully Kiosk
Browser) e cole o link. A tela se atualiza sozinha a cada minuto e não pede login.
"Trocar link" derruba o link antigo na hora.

## Atualizar depois

```bash
cd /opt/mercearia && ./scripts/atualizar.sh
```

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Site abre outro sistema ou dá 502 | `docker network inspect <rede> \| grep mercearia-app` — o contêiner tem que estar na rede do Caddy |
| Ver os logs | `docker compose -f docker-compose.prod.yml logs -f mercearia-app` |
| Voltar o isolamento do banco sem deploy | `DB_ISOLATION=off` no `.env` e `up -d mercearia-app` |
