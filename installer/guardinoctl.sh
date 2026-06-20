#!/usr/bin/env bash
set -euo pipefail

# Guardino Hub server command.
# Install with: guardino install-script

VERSION="3.0.0"
PROJECT_NAME="guardino-hub"
DEFAULT_INSTALL_DIR="/opt/guardino-hub"
REPO_URL_DEFAULT="https://github.com/Sir-Adnan/guardino-hub.git"
BRANCH_DEFAULT="main"
BACKUP_WRAPPER="/usr/local/bin/guardino-hub-backup.sh"
BACKUP_CRON_TAG="# guardino-hub-backup"
ORIGINAL_ARGS=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -n "${INSTALL_DIR:-}" ]; then
  INSTALL_DIR="${INSTALL_DIR}"
elif [ -f "${LOCAL_ROOT}/docker-compose.yml" ] && [ -f "${LOCAL_ROOT}/installer/install.sh" ]; then
  INSTALL_DIR="${LOCAL_ROOT}"
else
  INSTALL_DIR="${DEFAULT_INSTALL_DIR}"
fi

REPO_URL="${REPO_URL:-$REPO_URL_DEFAULT}"
BRANCH="${BRANCH:-$BRANCH_DEFAULT}"

if [ -t 1 ]; then
  BOLD='\033[1m'
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  GREY='\033[0;90m'
  NC='\033[0m'
else
  BOLD=''
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  CYAN=''
  GREY=''
  NC=''
fi

log() { echo -e "${BLUE}[guardino]${NC} $*"; }
ok() { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
fail() { echo -e "${RED}[error]${NC} $*" 1>&2; }

need_root() {
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    fail "Root privileges are required. Run as root or install sudo."
    exit 1
  fi
  exec sudo -E INSTALL_DIR="${INSTALL_DIR}" REPO_URL="${REPO_URL}" BRANCH="${BRANCH}" bash "$0" "${ORIGINAL_ARGS[@]}"
}

need_source() {
  if [ ! -f "${INSTALL_DIR}/docker-compose.yml" ]; then
    fail "Guardino source not found at: ${INSTALL_DIR}"
    fail "Run: guardino install"
    exit 1
  fi
}

need_cmd() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    fail "Required command not found: ${name}"
    exit 1
  fi
}

ensure_docker() {
  need_cmd docker
  if ! docker compose version >/dev/null 2>&1; then
    fail "Docker Compose v2 is required (docker compose ...)."
    exit 1
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
}

ensure_package() {
  local pkg="$1"
  local bin="${2:-$1}"
  if command -v "${bin}" >/dev/null 2>&1; then
    return 0
  fi
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y >/dev/null
    apt-get install -y "${pkg}" >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y "${pkg}" >/dev/null
  elif command -v yum >/dev/null 2>&1; then
    yum install -y "${pkg}" >/dev/null
  else
    fail "Cannot install ${pkg}; unsupported package manager."
    exit 1
  fi
}

ensure_nano() {
  if ! command -v nano >/dev/null 2>&1; then
    log "Installing nano editor..."
    ensure_package nano nano
  fi
}

is_ssl_enabled() {
  [ -f "${INSTALL_DIR}/deploy/docker-compose.ssl.yml" ] &&
    [ -f "${INSTALL_DIR}/deploy/nginx.conf" ] &&
    grep -q "listen 443" "${INSTALL_DIR}/deploy/nginx.conf"
}

compose_args() {
  printf "%s\n" "-f" "${INSTALL_DIR}/docker-compose.yml"
  if is_ssl_enabled; then
    printf "%s\n" "-f" "${INSTALL_DIR}/deploy/docker-compose.ssl.yml"
  fi
}

dc() {
  local args=()
  while IFS= read -r part; do
    args+=("${part}")
  done < <(compose_args)
  docker compose "${args[@]}" "$@"
}

base_dc() {
  docker compose -f "${INSTALL_DIR}/docker-compose.yml" "$@"
}

env_file() {
  echo "${INSTALL_DIR}/.env"
}

env_get() {
  local key="$1"
  local default="${2:-}"
  local file
  file="$(env_file)"
  if [ ! -f "${file}" ]; then
    echo "${default}"
    return 0
  fi
  local value
  value="$(grep -E "^${key}=" "${file}" | tail -n1 | cut -d= -f2- || true)"
  echo "${value:-$default}"
}

env_set() {
  local key="$1"
  local value="$2"
  local file
  file="$(env_file)"
  touch "${file}"
  local tmp
  tmp="$(mktemp)"
  awk -F= -v k="${key}" -v v="${value}" '
    BEGIN { done = 0 }
    $1 == k && done == 0 { print k "=" v; done = 1; next }
    { print }
    END { if (done == 0) print k "=" v }
  ' "${file}" > "${tmp}"
  mv "${tmp}" "${file}"
}

env_set_if_missing() {
  local key="$1"
  local value="$2"
  if [ -z "$(env_get "${key}" "")" ]; then
    env_set "${key}" "${value}"
  fi
}

env_set_if_legacy_default() {
  local key="$1"
  local value="$2"
  shift 2
  local current legacy
  current="$(env_get "${key}" "")"
  for legacy in "$@"; do
    if [ "${current}" = "${legacy}" ]; then
      env_set "${key}" "${value}"
      return 0
    fi
  done
  return 0
}

ensure_runtime_env_defaults() {
  env_set_if_missing "REDIS_URL" "redis://redis:6379/0"
  env_set_if_missing "USAGE_SYNC_SECONDS" "180"
  env_set_if_missing "EXPIRY_SYNC_SECONDS" "120"
  env_set_if_missing "USAGE_SYNC_BATCH_SIZE" "5000"
  env_set_if_missing "USAGE_SYNC_REMOTE_LIST_PAGE_SIZE" "1000"
  env_set_if_missing "USAGE_SYNC_REMOTE_LIST_MAX_PAGES" "200"
  env_set_if_missing "USAGE_SYNC_REMOTE_MISSING_CONFIRMATIONS" "3"
  env_set_if_missing "EXPIRY_SYNC_BATCH_SIZE" "1000"
  env_set_if_missing "HTTP_TIMEOUT_SECONDS" "60"
  env_set_if_missing "NEXT_PUBLIC_API_BASE" "/api"

  env_set_if_legacy_default "USAGE_SYNC_SECONDS" "180" "60"
  env_set_if_legacy_default "EXPIRY_SYNC_SECONDS" "120" "60"
  env_set_if_legacy_default "USAGE_SYNC_BATCH_SIZE" "5000" "2000"
  env_set_if_legacy_default "EXPIRY_SYNC_BATCH_SIZE" "1000" "500"
  env_set_if_legacy_default "HTTP_TIMEOUT_SECONDS" "60" "15" "20" "45"
}

backup_path() {
  local file="$1"
  local ts
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "${file}" "${file}.bak.${ts}"
  echo "${file}.bak.${ts}"
}

public_ip() {
  local ip
  ip="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
  if [[ "${ip}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "${ip}"
    return 0
  fi
  hostname -I 2>/dev/null | awk '{print $1}'
}

wait_health() {
  local tries="${1:-45}"
  local i
  for i in $(seq 1 "${tries}"); do
    if curl -fsS --max-time 3 http://localhost/health >/dev/null 2>&1; then
      ok "API health is OK."
      return 0
    fi
    sleep 2
  done
  warn "API health check did not pass yet."
  return 1
}

nginx_test() {
  need_source
  ensure_docker
  if ! dc ps nginx >/dev/null 2>&1; then
    warn "Nginx container is not available yet."
    return 1
  fi
  if dc exec -T nginx nginx -t; then
    ok "Nginx config test passed."
    return 0
  fi
  fail "Nginx config test failed."
  return 1
}

reload_nginx() {
  need_source
  ensure_docker
  if nginx_test; then
    dc exec -T nginx nginx -s reload
    ok "Nginx reloaded."
  fi
}

write_nginx_http() {
  local server_name="$1"
  mkdir -p "${INSTALL_DIR}/deploy/certbot/www"
  cat > "${INSTALL_DIR}/deploy/nginx.conf" <<CONF
server {
  listen 80;
  server_name ${server_name};

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location /health {
    proxy_pass http://api:8000/health;
    proxy_set_header Host \$host;
  }

  location = /api/docs {
    proxy_pass http://api:8000/api/docs;
    proxy_set_header Host \$host;
  }

  location = /api/openapi.json {
    proxy_pass http://api:8000/api/openapi.json;
    proxy_set_header Host \$host;
  }

  location = /api/redoc {
    proxy_pass http://api:8000/api/redoc;
    proxy_set_header Host \$host;
  }

  location /api/ {
    proxy_pass http://api:8000/api/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    proxy_pass http://web:3000;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
CONF
}

write_nginx_https() {
  local domain="$1"
  mkdir -p "${INSTALL_DIR}/deploy/certbot/www"
  cat > "${INSTALL_DIR}/deploy/nginx.conf" <<CONF
server {
  listen 80;
  server_name ${domain};

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location /health {
    proxy_pass http://api:8000/health;
    proxy_set_header Host \$host;
  }

  location /api/ {
    proxy_pass http://api:8000/api/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    return 301 https://\$host\$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name ${domain};

  ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;

  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 10m;
  ssl_protocols TLSv1.2 TLSv1.3;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location /health {
    proxy_pass http://api:8000/health;
    proxy_set_header Host \$host;
  }

  location = /api/docs {
    proxy_pass http://api:8000/api/docs;
    proxy_set_header Host \$host;
  }

  location = /api/openapi.json {
    proxy_pass http://api:8000/api/openapi.json;
  }

  location = /api/redoc {
    proxy_pass http://api:8000/api/redoc;
    proxy_set_header Host \$host;
  }

  location /api/ {
    proxy_pass http://api:8000/api/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }

  location / {
    proxy_pass http://web:3000;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
CONF
}

detect_domain() {
  local conf="${INSTALL_DIR}/deploy/nginx.conf"
  if [ ! -f "${conf}" ]; then
    echo ""
    return 0
  fi
  awk '/server_name/ { gsub(";", "", $2); if ($2 != "_") { print $2; exit } }' "${conf}" 2>/dev/null || true
}

validate_domain_dns() {
  local domain="$1"
  local server_ip resolved
  server_ip="$(public_ip)"
  resolved="$(getent ahostsv4 "${domain}" 2>/dev/null | awk '{print $1; exit}' || true)"
  if [ -z "${resolved}" ]; then
    warn "Could not resolve ${domain}. DNS may not be ready."
    return 0
  fi
  if [ -n "${server_ip}" ] && [ "${resolved}" != "${server_ip}" ]; then
    warn "DNS for ${domain} resolves to ${resolved}, but server public IP is ${server_ip}."
    warn "SSL issuance may fail until DNS points to this server."
  else
    ok "DNS looks good: ${domain} -> ${resolved}"
  fi
}

install_certbot_renew_cron() {
  local docker_bin
  docker_bin="$(command -v docker)"
  cat > /etc/cron.d/guardino-hub-certbot <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root certbot renew --quiet --deploy-hook "${docker_bin} compose -f ${INSTALL_DIR}/docker-compose.yml -f ${INSTALL_DIR}/deploy/docker-compose.ssl.yml restart nginx"
CRON
  chmod 644 /etc/cron.d/guardino-hub-certbot
}

cmd_up() {
  need_root "$@"
  need_source
  ensure_docker
  cd "${INSTALL_DIR}"
  dc config >/dev/null
  dc up -d
  wait_health 45 || true
}

cmd_down() {
  need_root "$@"
  need_source
  ensure_docker
  cd "${INSTALL_DIR}"
  dc down --remove-orphans
  ok "Guardino services are down. Docker volumes were preserved."
}

cmd_stop() {
  need_root "$@"
  need_source
  ensure_docker
  cd "${INSTALL_DIR}"
  dc stop
  ok "Guardino services stopped."
}

cmd_restart() {
  need_root "$@"
  need_source
  ensure_docker
  cd "${INSTALL_DIR}"
  local build="0"
  if [ "${1:-}" = "--build" ]; then
    build="1"
  fi
  log "Validating compose config..."
  dc config >/dev/null
  if is_ssl_enabled; then
    local domain
    domain="$(detect_domain)"
    if [ -n "${domain}" ] && [ ! -f "/etc/letsencrypt/live/${domain}/fullchain.pem" ]; then
      fail "SSL is enabled in nginx.conf, but certificate for ${domain} is missing."
      fail "Run: guardino ssl issue ${domain} your@email.com"
      exit 1
    fi
  fi
  log "Recreating services to apply env/config changes..."
  if [ "${build}" = "1" ]; then
    dc up -d --build --force-recreate
  else
    dc up -d --force-recreate
  fi
  nginx_test || true
  wait_health 60 || true
}

cmd_rebuild() {
  cmd_restart --build
}

cmd_status() {
  need_source
  ensure_docker
  cd "${INSTALL_DIR}"
  echo -e "${CYAN}==============================${NC}"
  echo -e "${BOLD}       Guardino Status${NC}"
  echo -e "${CYAN}==============================${NC}"
  echo "Install dir: ${INSTALL_DIR}"
  echo "Public IP:   $(public_ip || true)"
  echo "Domain:      $(detect_domain || echo "not set")"
  echo "SSL mode:    $(is_ssl_enabled && echo "enabled" || echo "http-only")"
  echo ""
  dc ps
  echo ""
  if curl -fsS --max-time 3 http://localhost/health >/dev/null 2>&1; then
    ok "Health: http://localhost/health is OK"
  else
    warn "Health: API is not responding on http://localhost/health"
  fi
  cert_status || true
}

cmd_logs() {
  need_source
  ensure_docker
  cd "${INSTALL_DIR}"
  local service="${1:-}"
  if [ -n "${service}" ]; then
    dc logs -f --tail=200 "${service}"
  else
    dc logs -f --tail=200
  fi
}

cmd_cli() {
  need_root "$@"
  need_source
  ensure_docker
  cd "${INSTALL_DIR}"
  if [ "${#}" -eq 0 ]; then
    dc exec api bash
  else
    dc exec api python -m app.cli "$@"
  fi
}

cmd_tui() {
  need_root "$@"
  need_source
  bash "${INSTALL_DIR}/installer/manage.sh" --menu
}

cmd_install() {
  need_root "$@"
  if [ ! -f "${INSTALL_DIR}/installer/install.sh" ]; then
    if ! command -v git >/dev/null 2>&1; then
      ensure_package git git
    fi
    mkdir -p "$(dirname "${INSTALL_DIR}")"
    if [ -d "${INSTALL_DIR}" ] && [ -n "$(ls -A "${INSTALL_DIR}" 2>/dev/null || true)" ]; then
      fail "INSTALL_DIR exists and is not empty: ${INSTALL_DIR}"
      exit 1
    fi
    git clone --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
  fi
  chmod +x "${INSTALL_DIR}/installer/install.sh" "${INSTALL_DIR}/installer/update.sh" "${INSTALL_DIR}/installer/manage.sh" "${INSTALL_DIR}/installer/guardinoctl.sh"
  INSTALL_DIR="${INSTALL_DIR}" REPO_URL="${REPO_URL}" BRANCH="${BRANCH}" bash "${INSTALL_DIR}/installer/install.sh"
  ensure_runtime_env_defaults
  INSTALL_DIR="${INSTALL_DIR}" bash "${INSTALL_DIR}/installer/guardinoctl.sh" install-script --yes || true
}

cmd_update() {
  need_root "$@"
  need_source
  chmod +x "${INSTALL_DIR}/installer/update.sh" "${INSTALL_DIR}/installer/guardinoctl.sh"
  echo "Guardino update will create a pre-migration DB backup unless SKIP_PRE_UPDATE_BACKUP=1 is set."
  echo "All pending Alembic migrations are applied with: alembic upgrade head"
  INSTALL_DIR="${INSTALL_DIR}" bash "${INSTALL_DIR}/installer/update.sh"
  ensure_runtime_env_defaults
  INSTALL_DIR="${INSTALL_DIR}" bash "${INSTALL_DIR}/installer/guardinoctl.sh" install-script --yes || true
}

cmd_uninstall() {
  need_root "$@"
  need_source
  ensure_docker
  cd "${INSTALL_DIR}"
  echo "Uninstall will stop and remove Guardino containers."
  echo "Database volumes are kept unless you explicitly choose to delete them."
  echo ""
  read -r -p "Type UNINSTALL to continue: " confirm
  if [ "${confirm}" != "UNINSTALL" ]; then
    warn "Uninstall cancelled."
    return 1
  fi
  dc down --remove-orphans || true
  (crontab -l 2>/dev/null | grep -vF "${BACKUP_WRAPPER}" | grep -vF "${BACKUP_CRON_TAG}" || true) | crontab - || true
  rm -f "${BACKUP_WRAPPER}"
  read -r -p "Delete database Docker volumes too? This is destructive. [y/N]: " wipe
  if [[ "${wipe:-N}" =~ ^[Yy]$ ]]; then
    dc down -v --remove-orphans || true
    warn "Docker volumes were removed."
  fi
  read -r -p "Remove command wrappers /usr/local/bin/guardino and /usr/local/bin/Guardino? [y/N]: " remove_cmd
  if [[ "${remove_cmd:-N}" =~ ^[Yy]$ ]]; then
    rm -f /usr/local/bin/guardino /usr/local/bin/Guardino
  fi
  ok "Uninstall completed."
}

cmd_backup() {
  need_root "$@"
  need_source
  local mode="${1:-full}"
  if [ "${mode}" = "lite" ]; then
    mode="essential"
  fi
  INSTALL_DIR="${INSTALL_DIR}" BACKUP_MODE="${mode}" bash "${INSTALL_DIR}/installer/manage.sh" --backup-now --backup-mode "${mode}"
}

ask_schedule() {
  echo "Backup schedule:"
  echo "  1) Every 30 minutes"
  echo "  2) Every 1 hour"
  echo "  3) Every 2 hours"
  echo "  4) Daily at 03:00"
  read -r -p "Select [2]: " pick
  case "${pick:-2}" in
    1) echo "*/30 * * * *" ;;
    2) echo "0 * * * *" ;;
    3) echo "0 */2 * * *" ;;
    4) echo "0 3 * * *" ;;
    *) echo "0 * * * *" ;;
  esac
}

cmd_backup_service() {
  need_root "$@"
  need_source
  local mode="${1:-full}"
  case "${mode}" in
    full|telegram|tg)
      INSTALL_DIR="${INSTALL_DIR}" bash "${INSTALL_DIR}/installer/manage.sh" --setup-telegram-full
      ;;
    lite|essential)
      INSTALL_DIR="${INSTALL_DIR}" bash "${INSTALL_DIR}/installer/manage.sh" --setup-telegram-lite
      ;;
    local)
      local expr
      expr="$(ask_schedule)"
      cat > "${BACKUP_WRAPPER}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR}" BACKUP_MODE="full" bash "${INSTALL_DIR}/installer/manage.sh" --backup-now --silent --backup-mode full
EOF
      chmod +x "${BACKUP_WRAPPER}"
      (crontab -l 2>/dev/null | grep -vF "${BACKUP_WRAPPER}" | grep -vF "${BACKUP_CRON_TAG}" || true) | crontab -
      (crontab -l 2>/dev/null; echo "${expr} ${BACKUP_WRAPPER} ${BACKUP_CRON_TAG}") | crontab -
      ok "Local backup service installed: ${expr}"
      ;;
    off|disable)
      INSTALL_DIR="${INSTALL_DIR}" bash "${INSTALL_DIR}/installer/manage.sh" --disable-backup
      ;;
    *)
      fail "Usage: guardino backup-service [full|lite|local|off]"
      exit 1
      ;;
  esac
}

cmd_restore() {
  need_root "$@"
  need_source
  local file="${1:-}"
  if [ -z "${file}" ]; then
    fail "Usage: guardino restore /path/to/guardino_backup_*.tar.gz"
    exit 1
  fi
  INSTALL_DIR="${INSTALL_DIR}" bash "${INSTALL_DIR}/installer/manage.sh" --restore "${file}"
}

validate_env_file() {
  local file
  file="$(env_file)"
  local errors=0
  local key value
  for key in USAGE_SYNC_SECONDS EXPIRY_SYNC_SECONDS USAGE_SYNC_BATCH_SIZE USAGE_SYNC_REMOTE_LIST_PAGE_SIZE USAGE_SYNC_REMOTE_LIST_MAX_PAGES USAGE_SYNC_REMOTE_MISSING_CONFIRMATIONS EXPIRY_SYNC_BATCH_SIZE HTTP_TIMEOUT_SECONDS; do
    value="$(env_get "${key}" "")"
    if [ -n "${value}" ] && ! [[ "${value}" =~ ^[0-9]+$ ]]; then
      fail "${key} must be a positive integer. Current value: ${value}"
      errors=$((errors + 1))
    fi
  done
  if [ -z "$(env_get DATABASE_URL "")" ]; then
    fail "DATABASE_URL is empty."
    errors=$((errors + 1))
  fi
  if [ "$(env_get SECRET_KEY "")" = "please-change-me" ]; then
    warn "SECRET_KEY is still the example value. Change it on production."
  fi
  [ "${errors}" -eq 0 ]
}

cmd_edit_file() {
  need_root "$@"
  need_source
  local target="$1"
  local validate="${2:-none}"
  if [ ! -f "${target}" ]; then
    fail "File not found: ${target}"
    exit 1
  fi
  ensure_nano
  local bak
  bak="$(backup_path "${target}")"
  log "Backup created: ${bak}"
  nano "${target}"
  if cmp -s "${target}" "${bak}"; then
    ok "No changes detected."
    return 0
  fi
  if [ "${validate}" = "compose" ]; then
    ensure_docker
    dc config >/dev/null
  elif [ "${validate}" = "env" ]; then
    validate_env_file
  fi
  echo ""
  read -r -p "Apply changes now by restarting Guardino? [Y/n]: " answer
  if [[ ! "${answer:-Y}" =~ ^[Nn]$ ]]; then
    cmd_restart
  else
    warn "Changes saved, but services were not restarted."
  fi
}

cmd_edit() {
  cmd_edit_file "${INSTALL_DIR}/docker-compose.yml" compose
}

cmd_edit_env() {
  need_root "$@"
  need_source
  if [ ! -f "$(env_file)" ] && [ -f "${INSTALL_DIR}/.env.example" ]; then
    cp "${INSTALL_DIR}/.env.example" "$(env_file)"
  fi
  ensure_runtime_env_defaults
  cmd_edit_file "$(env_file)" env
}

cmd_set_env() {
  need_root "$@"
  need_source
  local key="${1:-}"
  local value="${2:-}"
  if [ -z "${key}" ] || [ -z "${value}" ]; then
    fail "Usage: guardino set-env KEY VALUE"
    exit 1
  fi
  if [ ! -f "$(env_file)" ] && [ -f "${INSTALL_DIR}/.env.example" ]; then
    cp "${INSTALL_DIR}/.env.example" "$(env_file)"
  fi
  backup_path "$(env_file)" >/dev/null
  ensure_runtime_env_defaults
  env_set "${key}" "${value}"
  validate_env_file
  ok "${key} updated."
  echo "Run 'guardino restart' to apply it."
}

cmd_domain() {
  need_root "$@"
  need_source
  ensure_docker
  local sub="${1:-status}"
  case "${sub}" in
    status)
      echo "Domain: $(detect_domain || true)"
      echo "SSL:    $(is_ssl_enabled && echo enabled || echo disabled)"
      ;;
    set)
      local domain="${2:-}"
      if [ -z "${domain}" ]; then
        read -r -p "Domain/Subdomain: " domain
      fi
      domain="${domain// /}"
      if [ -z "${domain}" ]; then
        fail "Domain is required."
        exit 1
      fi
      validate_domain_dns "${domain}"
      backup_path "${INSTALL_DIR}/deploy/nginx.conf" >/dev/null 2>&1 || true
      write_nginx_http "${domain}"
      env_set "NEXT_PUBLIC_API_BASE" "/api"
      env_set "CORS_ORIGINS" "http://${domain},https://${domain}"
      dc up -d --force-recreate nginx
      nginx_test || true
      ok "Domain configured in HTTP mode: ${domain}"
      echo "For SSL: guardino ssl issue ${domain} your@email.com"
      ;;
    *)
      fail "Usage: guardino domain [status|set DOMAIN]"
      exit 1
      ;;
  esac
}

cert_status() {
  local domain
  domain="$(detect_domain)"
  if [ -z "${domain}" ]; then
    return 0
  fi
  local cert="/etc/letsencrypt/live/${domain}/fullchain.pem"
  if [ ! -f "${cert}" ]; then
    warn "SSL certificate: not found for ${domain}"
    return 0
  fi
  local end
  end="$(openssl x509 -in "${cert}" -noout -enddate 2>/dev/null | cut -d= -f2- || true)"
  if [ -n "${end}" ]; then
    ok "SSL certificate for ${domain} expires at: ${end}"
  fi
}

cmd_ssl() {
  need_root "$@"
  need_source
  ensure_docker
  local sub="${1:-status}"
  case "${sub}" in
    status)
      cert_status
      ;;
    issue|enable)
      ensure_package certbot certbot
      local domain="${2:-}"
      local email="${3:-}"
      if [ -z "${domain}" ]; then
        read -r -p "Domain/Subdomain: " domain
      fi
      if [ -z "${email}" ]; then
        read -r -p "Email for Let's Encrypt: " email
      fi
      domain="${domain// /}"
      email="${email// /}"
      if [ -z "${domain}" ] || [ -z "${email}" ]; then
        fail "Usage: guardino ssl issue DOMAIN EMAIL"
        exit 1
      fi
      validate_domain_dns "${domain}"
      write_nginx_http "${domain}"
      base_dc up -d nginx web api
      certbot certonly \
        --webroot -w "${INSTALL_DIR}/deploy/certbot/www" \
        -d "${domain}" \
        --email "${email}" \
        --agree-tos --non-interactive \
        --keep-until-expiring
      write_nginx_https "${domain}"
      install_certbot_renew_cron
      dc up -d --force-recreate nginx
      nginx_test || true
      ok "SSL enabled for ${domain}."
      ;;
    renew)
      ensure_package certbot certbot
      certbot renew
      dc restart nginx
      ok "SSL renewal command completed and nginx restarted."
      ;;
    *)
      fail "Usage: guardino ssl [status|issue DOMAIN EMAIL|renew]"
      exit 1
      ;;
  esac
}

cmd_doctor() {
  need_source
  echo -e "${CYAN}==============================${NC}"
  echo -e "${BOLD}       Guardino Doctor${NC}"
  echo -e "${CYAN}==============================${NC}"
  echo "Install dir: ${INSTALL_DIR}"
  echo "Public IP:   $(public_ip || true)"
  echo ""

  if command -v docker >/dev/null 2>&1; then ok "docker found"; else fail "docker missing"; fi
  if docker compose version >/dev/null 2>&1; then ok "docker compose v2 found"; else fail "docker compose v2 missing"; fi
  if [ -f "$(env_file)" ]; then ok ".env exists"; else fail ".env missing"; fi
  validate_env_file || true
  ensure_docker
  if dc config >/dev/null; then ok "compose config valid"; else fail "compose config invalid"; fi
  if command -v ss >/dev/null 2>&1; then
    echo ""
    echo "Listening on 80/443:"
    ss -ltnp 2>/dev/null | awk '$4 ~ /:80$|:443$/ {print}' || true
  fi
  echo ""
  df -h "${INSTALL_DIR}" || true
  echo ""
  cmd_status || true
}

cmd_install_script() {
  need_root "$@"
  local yes="${1:-}"
  if [ "${yes}" != "--yes" ]; then
    echo "This installs /usr/local/bin/guardino and /usr/local/bin/Guardino"
    read -r -p "Continue? [Y/n]: " answer
    if [[ "${answer:-Y}" =~ ^[Nn]$ ]]; then
      return 0
    fi
  fi
  mkdir -p /usr/local/bin
  cat > /usr/local/bin/guardino <<EOF
#!/usr/bin/env bash
export INSTALL_DIR="${INSTALL_DIR}"
exec bash "${INSTALL_DIR}/installer/guardinoctl.sh" "\$@"
EOF
  chmod +x /usr/local/bin/guardino
  cat > /usr/local/bin/Guardino <<EOF
#!/usr/bin/env bash
export INSTALL_DIR="${INSTALL_DIR}"
exec bash "${INSTALL_DIR}/installer/guardinoctl.sh" "\$@"
EOF
  chmod +x /usr/local/bin/Guardino
  ok "Installed commands: guardino, Guardino"
}

cmd_install_node() {
  echo "Guardino does not need a separate Guardino node agent yet."
  echo "Add remote panels from: Admin -> Nodes"
  echo "Supported panels: Marzban, PasarGuard, WireGuard Dashboard"
}

show_help() {
  cat <<EOF
==============================
           Guardino Help
==============================
Usage:
  guardino [command] [options]

Commands:
  up                 Start services
  down               Stop and remove containers (keeps volumes)
  start              Start existing services
  stop               Stop services
  restart            Recreate services and apply .env changes
  rebuild            Rebuild and recreate services
  status             Show service, health, domain and SSL status
  logs [service]     Follow logs
  cli [args...]      Run Guardino backend CLI or open API shell
  tui                Open interactive Guardino manager

  install            Install Guardino
  update             Update to latest version
  uninstall          Stop services and optionally remove data
  install-script     Install guardino/Guardino command
  install-node       Show node setup guide

  backup [full|lite] Manual backup
  backup-service     Setup Telegram/local backup service
  restore FILE       Restore database/config backup

  edit               Edit docker-compose.yml with nano
  edit-env           Edit .env with nano and restart prompt
  set-env KEY VALUE  Update one .env key

  domain status      Show current domain
  domain set DOMAIN  Configure HTTP domain
  ssl status         Show certificate status
  ssl issue D E      Issue/enable Let's Encrypt SSL
  ssl renew          Renew SSL and restart nginx
  renew-ssl          Alias for ssl renew
  reload-nginx       Test and reload nginx
  doctor             Run deployment diagnostics
  help               Show this help message

Directories:
  App directory:  ${INSTALL_DIR}
  Backup dir:     ${INSTALL_DIR}/backups
================================
EOF
}

main() {
  local cmd="${1:-help}"
  if [ "${cmd}" = "--install" ]; then cmd="install"; shift; elif [ "${cmd}" = "--update" ]; then cmd="update"; shift; fi
  if [ "${1:-}" = "${cmd}" ]; then
    shift || true
  fi

  case "${cmd}" in
    up|start) cmd_up "$@" ;;
    down) cmd_down "$@" ;;
    stop) cmd_stop "$@" ;;
    restart) cmd_restart "$@" ;;
    rebuild) cmd_rebuild "$@" ;;
    status) cmd_status "$@" ;;
    logs) cmd_logs "$@" ;;
    cli) cmd_cli "$@" ;;
    tui|menu) cmd_tui "$@" ;;
    install) cmd_install "$@" ;;
    update) cmd_update "$@" ;;
    uninstall) cmd_uninstall "$@" ;;
    install-script) cmd_install_script "$@" ;;
    install-node) cmd_install_node "$@" ;;
    backup) cmd_backup "$@" ;;
    backup-service) cmd_backup_service "$@" ;;
    restore) cmd_restore "$@" ;;
    edit) cmd_edit "$@" ;;
    edit-env) cmd_edit_env "$@" ;;
    set-env) cmd_set_env "$@" ;;
    domain) cmd_domain "$@" ;;
    ssl) cmd_ssl "$@" ;;
    renew-ssl) cmd_ssl renew "$@" ;;
    reload-nginx) reload_nginx "$@" ;;
    nginx-test) nginx_test "$@" ;;
    doctor) cmd_doctor "$@" ;;
    help|-h|--help) show_help ;;
    *)
      fail "Unknown command: ${cmd}"
      echo ""
      show_help
      exit 1
      ;;
  esac
}

main "$@"
