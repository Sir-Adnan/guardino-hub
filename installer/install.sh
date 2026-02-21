#!/usr/bin/env bash
set -euo pipefail

# Guardino Hub installer skeleton (Ubuntu 22/24)
# - installs docker
# - clones repo
# - creates .env (interactive)
# - runs docker compose, migrations, creates superadmin

REPO_URL="${REPO_URL:-https://github.com/Sir-Adnan/guardino-hub.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/guardino-hub}"

echo "[1/7] Installing prerequisites..."
apt-get update -y
apt-get install -y ca-certificates curl git

echo "[2/7] Installing Docker..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "[3/7] Installing repository into $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  cd "$INSTALL_DIR" && git pull
fi
cd "$INSTALL_DIR"

echo "[4/7] Creating .env ..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Edit $INSTALL_DIR/.env and set SECRET_KEY, DATABASE_URL, CORS_ORIGINS, etc."
fi

echo "[5/7] Starting services..."
docker compose up -d --build

echo "[6/7] Running migrations..."
docker compose exec -T api alembic upgrade head

echo "[7/7] Create superadmin..."
echo "Run:"
echo "  docker compose exec api python -m app.cli create-superadmin --username admin --password 'CHANGE_ME'"
echo "Done."
