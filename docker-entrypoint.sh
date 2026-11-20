#!/usr/bin/env sh
#
# Aplica as migrações antes de subir. Migração é sempre compatível para trás
# (expand → migrate → contract), então rodar isto na subida é seguro.
set -e

echo "→ aplicando migrações"
npx --no-install prisma migrate deploy --schema apps/api/prisma/schema.prisma

echo "→ subindo o Mercearia"
exec "$@"
