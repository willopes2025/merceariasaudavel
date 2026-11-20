#!/usr/bin/env bash
# Atualiza a Mercearia Saudável na VPS com um comando só:
#
#   cd /opt/mercearia && ./scripts/atualizar.sh
#
# Faz backup, baixa o código novo, reconstrói, espera o sistema subir, roda o
# seed e mostra a versão. Se algo falhar, para e diz onde.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"
URL="${MERCEARIA_URL:-https://mercearia.wideic.com}/v1/health"

echo "1/5 · Backup do banco"
./scripts/backup.sh

echo "2/5 · Baixando o código novo"
git pull --ff-only

echo "3/5 · Reconstruindo (leva alguns minutos)"
$COMPOSE up -d --build mercearia-app

echo "4/5 · Esperando o sistema subir"
for i in $(seq 1 40); do
  if curl -fsS "$URL" >/dev/null 2>&1; then break; fi
  if [ "$i" = 40 ]; then
    echo "!! O sistema não respondeu em 2 minutos. Veja o motivo com:"
    echo "   $COMPOSE logs --tail=40 mercearia-app"
    exit 1
  fi
  sleep 3
done

echo "5/5 · Atualizando perfis e cadastros padrão"
$COMPOSE exec -T mercearia-app node apps/api/prisma/seed.mjs

echo
echo "Pronto. Versão no ar:"
curl -fsS "$URL"
echo
