#!/usr/bin/env bash
set -euo pipefail

# Usage: bash deploy/backup.sh [/opt/guardino-hub] [output_dir]
ROOT="${1:-$(pwd)}"
OUT="${2:-$ROOT/backups}"

ENV_FILE="$ROOT/.env"
DB_NAME="guardino"
DB_USER="guardino"
if [ -f "$ENV_FILE" ]; then
  DB_NAME="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"\r' || true)"
  DB_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"\r' || true)"
  DB_NAME="${DB_NAME:-guardino}"
  DB_USER="${DB_USER:-guardino}"
fi

mkdir -p "$OUT"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

echo "Backing up database..."
docker compose -f "$ROOT/docker-compose.yml" exec -T db pg_dump -U "$DB_USER" "$DB_NAME" > "$OUT/db_$TS.sql"

echo "Backing up env (without secrets if you want)..."
cp "$ROOT/.env" "$OUT/env_$TS.env"

echo "Done: $OUT"
