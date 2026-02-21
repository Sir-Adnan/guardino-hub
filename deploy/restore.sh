#!/usr/bin/env bash
set -euo pipefail

# Usage: bash deploy/restore.sh [/opt/guardino-hub] path/to/db_dump.sql
ROOT="${1:-$(pwd)}"
DUMP="${2:-}"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Provide dump file: bash deploy/restore.sh /opt/guardino-hub backups/db_XXXX.sql"
  exit 1
fi

echo "Restoring database from $DUMP ..."
cat "$DUMP" | docker compose -f "$ROOT/docker-compose.yml" exec -T db psql -U guardino guardino

echo "Done."
