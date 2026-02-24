#!/usr/bin/env bash
set -euo pipefail

# Usage: bash deploy/restore.sh [/opt/guardino-hub] path/to/db_dump.sql
ROOT="${1:-$(pwd)}"
DUMP="${2:-}"

ENV_FILE="$ROOT/.env"
DB_NAME="guardino"
DB_USER="guardino"
if [ -f "$ENV_FILE" ]; then
  DB_NAME="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"\r' || true)"
  DB_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"\r' || true)"
  DB_NAME="${DB_NAME:-guardino}"
  DB_USER="${DB_USER:-guardino}"
fi

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Provide dump file: bash deploy/restore.sh /opt/guardino-hub backups/db_XXXX.sql"
  exit 1
fi

echo "Restoring database from $DUMP ..."
cat "$DUMP" | docker compose -f "$ROOT/docker-compose.yml" exec -T db psql -U "$DB_USER" "$DB_NAME"

echo "Done."
