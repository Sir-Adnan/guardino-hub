#!/usr/bin/env bash
set -euo pipefail

# Guardino Hub installer (Ubuntu 22/24)
# - installs docker
# - clones repo
# - creates .env with generated secrets
# - runs docker compose (nginx + web + api + worker + beat + db + redis)
# - runs migrations
# - creates superadmin with random password (printed at end)

REPO_URL="${REPO_URL:-https://github.com/Sir-Adnan/guardino-hub.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/guardino-hub}"

echo "[1/8] Installing prerequisites..."
apt-get update -y
apt-get install -y ca-certificates curl git openssl

echo "[2/8] Installing Docker..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin not found; reinstall docker or install compose plugin."
  exit 1
fi

echo "[3/8] Cloning repo into $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  cd "$INSTALL_DIR" && git pull
fi
cd "$INSTALL_DIR"

echo "[4/8] Creating .env ..."
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET_KEY=$(openssl rand -hex 32)
  DB_PASS=$(openssl rand -hex 16)

  # Replace defaults
  sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$SECRET_KEY/" .env
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgresql+asyncpg://guardino:$DB_PASS@db:5432/guardino#" .env

  echo "Generated SECRET_KEY and DB password."
  echo "Edit .env to set CORS_ORIGINS and NEXT_PUBLIC_API_BASE if needed."
fi

echo "[5/8] Starting services..."
docker compose up -d --build

echo "[6/8] Running migrations..."
docker compose exec -T api alembic upgrade head

echo "[7/8] Creating superadmin..."
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS=$(openssl rand -base64 18 | tr -d "=+/")
docker compose exec -T api python -m app.cli create-superadmin --username "$ADMIN_USER" --password "$ADMIN_PASS" || true

echo "[8/8] Done."
echo "----------------------------------------"
echo "Superadmin username: $ADMIN_USER"
echo "Superadmin password: $ADMIN_PASS"
echo "Open: http://<server-ip>/"
echo "API docs: http://<server-ip>/api/docs (proxied)"
echo "----------------------------------------"


# Optional HTTPS (Caddy)
# 1) set DOMAIN and ADMIN_EMAIL in .env
# 2) run: docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml up -d --build
