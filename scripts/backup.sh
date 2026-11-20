#!/usr/bin/env bash
#
# Backup do banco do Mercearia em ./backups (guarda 14 dias).
# Agendar todo dia às 3h (crontab -e na VPS):
#   0 3 * * * cd /opt/mercearia && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
mkdir -p backups

file="backups/mercearia-$(date +%Y%m%d-%H%M).sql.gz"
docker compose -f docker-compose.prod.yml exec -T mercearia-db \
  pg_dump -U "${POSTGRES_USER:-mercearia}" -d "${POSTGRES_DB:-mercearia}" --no-owner | gzip > "$file"

# Arquivo vazio = backup falhou: não apaga os antigos.
if [ ! -s "$file" ]; then
  echo "! backup vazio: $file" >&2
  exit 1
fi
find backups -name 'mercearia-*.sql.gz' -mtime +14 -delete
echo "→ $file ($(du -h "$file" | cut -f1))"
