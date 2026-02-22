#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Sir-Adnan/guardino-hub.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/guardino-hub}"

echo "[1/10] Installing prerequisites..."
apt-get update -y
apt-get install -y ca-certificates curl git openssl

echo "[2/10] Installing Docker..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null

echo "[3/10] Cloning repo into $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  cd "$INSTALL_DIR" && git pull
fi
cd "$INSTALL_DIR"

echo "[4/10] Creating .env ..."
if [ ! -f .env ]; then
  cp .env.example .env
fi

# Ensure Postgres vars exist
grep -q '^POSTGRES_DB=' .env || echo "POSTGRES_DB=guardino" >> .env
grep -q '^POSTGRES_USER=' .env || echo "POSTGRES_USER=guardino" >> .env

POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2- || true)"
if [ -z "${POSTGRES_PASSWORD:-}" ] || [ "${POSTGRES_PASSWORD:-}" = "guardino" ]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 16)"
  if grep -q '^POSTGRES_PASSWORD=' .env; then
    sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$POSTGRES_PASSWORD/" .env
  else
    echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" >> .env
  fi
fi

SECRET_KEY="$(grep -E '^SECRET_KEY=' .env | cut -d= -f2- || true)"
if [ -z "${SECRET_KEY:-}" ] || [ "${SECRET_KEY:-}" = "please-change-me" ]; then
  SECRET_KEY="$(openssl rand -hex 32)"
  if grep -q '^SECRET_KEY=' .env; then
    sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$SECRET_KEY/" .env
  else
    echo "SECRET_KEY=$SECRET_KEY" >> .env
  fi
fi

DB_USER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-)"
DB_NAME="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2-)"
DATABASE_URL="postgresql+asyncpg://${DB_USER}:${POSTGRES_PASSWORD}@db:5432/${DB_NAME}"
if grep -q '^DATABASE_URL=' .env; then
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$DATABASE_URL#" .env
else
  echo "DATABASE_URL=$DATABASE_URL" >> .env
fi

grep -q '^REDIS_URL=' .env || echo "REDIS_URL=redis://redis:6379/0" >> .env
grep -q '^REFUND_WINDOW_DAYS=' .env || echo "REFUND_WINDOW_DAYS=10" >> .env
grep -q '^HTTP_TIMEOUT_SECONDS=' .env || echo "HTTP_TIMEOUT_SECONDS=20" >> .env
grep -q '^PANEL_TLS_VERIFY=' .env || echo "PANEL_TLS_VERIFY=true" >> .env

echo "[5/10] Validating docker-compose.yml ..."
docker compose config >/dev/null

echo "[6/10] Starting services..."
docker compose down --remove-orphans || true
docker compose up -d --build

echo "[7/10] Waiting for API ..."
for i in $(seq 1 60); do
  CID="$(docker compose ps -q api || true)"
  if [ -n "$CID" ] && [ "$(docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null || echo false)" = "true" ]; then
    break
  fi
  sleep 1
done

CID="$(docker compose ps -q api || true)"
if [ -z "$CID" ] || [ "$(docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null || echo false)" != "true" ]; then
  echo "ERROR: api is not running."
  docker compose logs -n 200 --no-color api || true
  exit 1
fi

echo "[8/10] Running migrations..."
docker compose exec -T api alembic upgrade head

echo "[9/10] Creating superadmin..."
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="$(openssl rand -base64 18 | tr -d '=+/')"
docker compose exec -T api python -m app.cli create-superadmin --username "$ADMIN_USER" --password "$ADMIN_PASS" || true

echo "[10/10] Done."
echo "----------------------------------------"
echo "Superadmin username: $ADMIN_USER"
echo "Superadmin password: $ADMIN_PASS"
echo "Open: http://<server-ip>/"
echo "API docs: http://<server-ip>/api/docs"
echo "Health: http://<server-ip>/health"
echo "----------------------------------------"
