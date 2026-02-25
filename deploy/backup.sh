#!/usr/bin/env bash
set -euo pipefail

# Usage: bash deploy/backup.sh [/opt/guardino-hub] [output_dir]
ROOT="${1:-$(pwd)}"
OUT="${2:-$ROOT/backups}"

mkdir -p "$OUT"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

echo "Backing up database..."
docker compose -f "$ROOT/docker-compose.yml" exec -T db pg_dump -U guardino guardino > "$OUT/db_$TS.sql"

echo "Backing up env (without secrets if you want)..."
cp "$ROOT/.env" "$OUT/env_$TS.env"

echo "Done: $OUT"
