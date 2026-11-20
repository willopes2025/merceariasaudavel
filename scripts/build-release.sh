#!/usr/bin/env bash
#
# Empacota o Mercearia para produção (mesmo desenho do Soul ERP): compila o pacote
# compartilhado, o front e a API, e junta tudo num processo só.
#
#   apps/api/dist      → API compilada
#   apps/api/public/   → sistema web (/)
#
# Uso: ./scripts/build-release.sh
set -euo pipefail

cd "$(dirname "$0")/.."
echo "→ pacote compartilhado"
npm run build -w @mercearia/contracts

echo "→ cliente Prisma"
npm run db:generate -w @mercearia/api

echo "→ API"
npm run build -w @mercearia/api

echo "→ sistema web"
VITE_API_URL=/v1 npm run build -w @mercearia/web

echo "→ juntando o pacote"
rm -rf apps/api/public
mkdir -p apps/api/public
cp -r apps/web/dist apps/api/public/web

echo
echo "Pronto. Para rodar:"
echo "  DATABASE_URL=... JWT_SECRET=... node apps/api/dist/main.js"
