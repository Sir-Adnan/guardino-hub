#!/usr/bin/env bash
set -euo pipefail

# Safe updater for existing Guardino Hub deployments.
# - Pull latest code (if git repo)
# - Ensure critical .env keys exist with safe defaults
# - Recreate services (applies restart policies and new images)
# - Run DB migrations

DEFAULT_INSTALL_DIR="/opt/guardino-hub"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -n "${INSTALL_DIR:-}" ]; then
  INSTALL_DIR="${INSTALL_DIR}"
elif [ -f "${LOCAL_ROOT}/docker-compose.yml" ] && [ -f "${LOCAL_ROOT}/installer/install.sh" ]; then
  INSTALL_DIR="${LOCAL_ROOT}"
else
  INSTALL_DIR="${DEFAULT_INSTALL_DIR}"
fi

# run as root
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "ERROR: updater requires root privileges (or sudo)." 1>&2
    exit 1
  fi
  exec sudo -E bash "$0" "$@"
fi

log() { echo -e "\033[1;34m$*\033[0m"; }
warn(){ echo -e "\033[1;33m$*\033[0m"; }
err() { echo -e "\033[1;31m$*\033[0m" 1>&2; }

if [ ! -f "${INSTALL_DIR}/docker-compose.yml" ] || [ ! -d "${INSTALL_DIR}/backend" ]; then
  err "Guardino source not found at INSTALL_DIR=${INSTALL_DIR}"
  exit 1
fi

cd "${INSTALL_DIR}"
log "Guardino Hub updater"
log "INSTALL_DIR=${INSTALL_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  err "Docker is not installed."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  err "Docker Compose v2 is required."
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now docker >/dev/null 2>&1 || true
fi

if [ -d ".git" ]; then
  log "[1/5] Pulling latest source..."
  git pull --ff-only || {
    warn "git pull failed (maybe local changes). Continuing with current source."
  }
else
  warn "[1/5] No .git directory found; skipping git pull."
fi

log "[2/5] Ensuring .env and critical sync settings..."
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    err "Missing both .env and .env.example"
    exit 1
  fi
fi

ensure_kv() {
  local key="$1"; local val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s#^${key}=.*#${key}=${val}#" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

# Keep periodic tasks predictable after every update.
ensure_kv "REDIS_URL" "redis://redis:6379/0"
ensure_kv "USAGE_SYNC_SECONDS" "60"
ensure_kv "EXPIRY_SYNC_SECONDS" "60"
ensure_kv "USAGE_SYNC_BATCH_SIZE" "2000"
ensure_kv "EXPIRY_SYNC_BATCH_SIZE" "500"
ensure_kv "NEXT_PUBLIC_API_BASE" "/api"

log "[3/5] Validating compose config..."
docker compose -f docker-compose.yml config >/dev/null

COMPOSE=(docker compose -f docker-compose.yml)
if [ -f deploy/docker-compose.ssl.yml ] && grep -q "listen 443" deploy/nginx.conf; then
  COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.ssl.yml)
fi

log "[4/5] Recreating services..."
"${COMPOSE[@]}" up -d --build --force-recreate

log "[5/5] Applying migrations..."
"${COMPOSE[@]}" run --rm api alembic upgrade head

log "Update completed."
echo "USAGE_SYNC_SECONDS=$(grep -E '^USAGE_SYNC_SECONDS=' .env | cut -d= -f2-)"
echo "EXPIRY_SYNC_SECONDS=$(grep -E '^EXPIRY_SYNC_SECONDS=' .env | cut -d= -f2-)"
