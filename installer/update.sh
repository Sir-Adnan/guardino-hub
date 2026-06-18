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
  log "[1/6] Syncing latest source..."
  sync_git_source "${INSTALL_DIR}"
else
  warn "[1/6] No .git directory found; skipping source sync."
fi

patch_runtime_nginx_docs_routes

log "[2/6] Ensuring .env and critical sync settings..."
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

env_get() {
  local key="$1"; local default_val="${2:-}"
  local raw
  raw="$(grep -E "^${key}=" .env | tail -n1 | cut -d= -f2- || true)"
  if [ -z "$raw" ]; then
    echo "$default_val"
  else
    echo "$raw"
  fi
}

log "[3/6] Validating compose config..."
docker compose -f docker-compose.yml config >/dev/null

COMPOSE=(docker compose -f docker-compose.yml)
if [ -f deploy/docker-compose.ssl.yml ] && grep -q "listen 443" deploy/nginx.conf; then
  COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.ssl.yml)
fi

wait_for_db() {
  local db_user="$1"; local db_name="$2"
  local i
  for i in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T db pg_isready -U "${db_user}" -d "${db_name}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

create_pre_update_backup() {
  if [ "${SKIP_PRE_UPDATE_BACKUP:-0}" = "1" ]; then
    warn "[4/6] Pre-update DB backup skipped by SKIP_PRE_UPDATE_BACKUP=1"
    return 0
  fi

  local db_user db_name ts backup_dir dump_file archive_file
  db_user="$(env_get POSTGRES_USER guardino)"
  db_name="$(env_get POSTGRES_DB guardino)"
  ts="$(date -u +'%Y%m%dT%H%M%SZ')"
  backup_dir="${INSTALL_DIR}/backups/pre-update-${ts}"
  dump_file="${backup_dir}/db.sql"
  archive_file="${dump_file}.gz"

  log "[4/6] Creating pre-migration database backup..."
  mkdir -p "${backup_dir}"
  "${COMPOSE[@]}" up -d db >/dev/null
  if ! wait_for_db "${db_user}" "${db_name}"; then
    err "Database is not ready; update aborted before migrations."
    err "No schema change was applied. Re-run after DB is healthy, or set SKIP_PRE_UPDATE_BACKUP=1 if you intentionally accept the risk."
    exit 1
  fi

  if ! "${COMPOSE[@]}" exec -T db pg_dump -U "${db_user}" -d "${db_name}" --no-owner --no-privileges > "${dump_file}"; then
    err "Pre-update database backup failed; update aborted before migrations."
    err "No schema change was applied. Fix PostgreSQL/permissions, or set SKIP_PRE_UPDATE_BACKUP=1 if you intentionally accept the risk."
    exit 1
  fi
  gzip -9 "${dump_file}"
  log "Pre-update DB backup saved: ${archive_file}"
}

create_pre_update_backup

log "[5/6] Recreating services..."
"${COMPOSE[@]}" up -d --build --force-recreate

log "[6/6] Applying migrations..."
"${COMPOSE[@]}" run --rm api alembic upgrade head

if [ -x "${INSTALL_DIR}/installer/guardinoctl.sh" ]; then
  log "Refreshing guardino command..."
  INSTALL_DIR="${INSTALL_DIR}" bash "${INSTALL_DIR}/installer/guardinoctl.sh" install-script --yes || true
fi

log "Update completed."
echo "USAGE_SYNC_SECONDS=$(grep -E '^USAGE_SYNC_SECONDS=' .env | cut -d= -f2-)"
echo "EXPIRY_SYNC_SECONDS=$(grep -E '^EXPIRY_SYNC_SECONDS=' .env | cut -d= -f2-)"
