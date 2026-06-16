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

sync_git_source() {
  local dir="$1"
  local branch="${BRANCH:-main}"
  local repo_url="${REPO_URL:-https://github.com/Sir-Adnan/guardino-hub.git}"

  cd "$dir"
  local origin_url backup_dir dirty
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  if [ -z "$origin_url" ]; then
    git remote add origin "$repo_url"
  elif [ "$origin_url" != "$repo_url" ]; then
    git remote set-url origin "$repo_url"
  fi

  git fetch --prune origin "$branch"

  dirty="0"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    dirty="1"
  fi

  backup_dir=""
  if [ "$dirty" = "1" ]; then
    backup_dir="$dir/backups/local-git-changes-$(date -u +'%Y%m%dT%H%M%SZ')"
    mkdir -p "$backup_dir/files"
    git status --short > "$backup_dir/status.txt" || true
    git diff > "$backup_dir/unstaged.patch" || true
    git diff --cached > "$backup_dir/staged.patch" || true
    {
      git diff --name-only
      git diff --cached --name-only
    } | sort -u | while IFS= read -r changed_file; do
      [ -n "$changed_file" ] || continue
      if [ -f "$changed_file" ]; then
        mkdir -p "$backup_dir/files/$(dirname "$changed_file")"
        cp -a "$changed_file" "$backup_dir/files/$changed_file"
      fi
    done
    warn "Local git changes backed up to: ${backup_dir}"
  fi

  git reset --hard "origin/$branch"

  if [ -n "$backup_dir" ] && [ -f "$backup_dir/files/deploy/nginx.conf" ]; then
    mkdir -p "$dir/deploy"
    cp -a "$backup_dir/files/deploy/nginx.conf" "$dir/deploy/nginx.conf"
    warn "Preserved server nginx config: deploy/nginx.conf"
  fi
}

patch_runtime_nginx_docs_routes() {
  local conf="${INSTALL_DIR}/deploy/nginx.conf"
  [ -f "$conf" ] || return 0
  sed -i '/location .*\/api\/docs/,/}/{s#proxy_pass http://api:8000/docs;#proxy_pass http://api:8000/api/docs;#}' "$conf"
  sed -i '/location .*\/api\/openapi\.json/,/}/{s#proxy_pass http://api:8000/openapi.json;#proxy_pass http://api:8000/api/openapi.json;#}' "$conf"
  sed -i '/location .*\/api\/redoc/,/}/{s#proxy_pass http://api:8000/redoc;#proxy_pass http://api:8000/api/redoc;#}' "$conf"
}

if [ -d ".git" ]; then
  log "[1/5] Syncing latest source..."
  sync_git_source "${INSTALL_DIR}"
else
  warn "[1/5] No .git directory found; skipping source sync."
fi

patch_runtime_nginx_docs_routes

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

ensure_kv_if_missing() {
  local key="$1"; local val="$2"
  if ! grep -q "^${key}=" .env; then
    echo "${key}=${val}" >> .env
  fi
}

# Keep required runtime keys present, but preserve server-specific tuning.
ensure_kv_if_missing "REDIS_URL" "redis://redis:6379/0"
ensure_kv_if_missing "USAGE_SYNC_SECONDS" "60"
ensure_kv_if_missing "EXPIRY_SYNC_SECONDS" "60"
ensure_kv_if_missing "USAGE_SYNC_BATCH_SIZE" "2000"
ensure_kv_if_missing "EXPIRY_SYNC_BATCH_SIZE" "500"
ensure_kv_if_missing "NEXT_PUBLIC_API_BASE" "/api"

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

if [ -x "${INSTALL_DIR}/installer/guardinoctl.sh" ]; then
  log "Refreshing guardino command..."
  INSTALL_DIR="${INSTALL_DIR}" bash "${INSTALL_DIR}/installer/guardinoctl.sh" install-script --yes || true
fi

log "Update completed."
echo "USAGE_SYNC_SECONDS=$(grep -E '^USAGE_SYNC_SECONDS=' .env | cut -d= -f2-)"
echo "EXPIRY_SYNC_SECONDS=$(grep -E '^EXPIRY_SYNC_SECONDS=' .env | cut -d= -f2-)"
