#!/usr/bin/env bash
set -euo pipefail

# One-click installer for Guardino Hub
# - Asks for domain/subdomain (optional)
# - Optional Let's Encrypt SSL via certbot (nginx webroot)
# - Builds & starts docker-compose stack
# - Runs migrations & creates superadmin

REPO_URL="${REPO_URL:-https://github.com/Sir-Adnan/guardino-hub.git}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_INSTALL_DIR="/opt/guardino-hub"
if [ -n "${INSTALL_DIR:-}" ]; then
  INSTALL_DIR="${INSTALL_DIR}"
elif [ -f "${LOCAL_ROOT}/docker-compose.yml" ] && [ -f "${LOCAL_ROOT}/installer/install.sh" ]; then
  INSTALL_DIR="${LOCAL_ROOT}"
else
  INSTALL_DIR="${DEFAULT_INSTALL_DIR}"
fi
BRANCH="${BRANCH:-}"
RESET_DATA="${RESET_DATA:-0}"   # set to 1 to wipe docker volumes

# run as root
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "ERROR: This installer needs root privileges. Run as root or install sudo." 1>&2
    exit 1
  fi
  exec sudo -E bash "$0" "$@"
fi

log() { echo -e "\033[1;34m$*\033[0m"; }
warn(){ echo -e "\033[1;33m$*\033[0m"; }
err() { echo -e "\033[1;31m$*\033[0m" 1>&2; }

log "Guardino Hub installer"

DOMAIN=""
USE_SSL="no"
LE_EMAIL=""

read -r -p "Domain/Subdomain (leave blank to use IP): " DOMAIN || true
DOMAIN="${DOMAIN// /}"
if [ -n "${DOMAIN}" ]; then
  read -r -p "Enable SSL (Let's Encrypt) for ${DOMAIN}? [y/N]: " _ssl || true
  if [[ "${_ssl}" =~ ^[Yy]$ ]]; then
    USE_SSL="yes"
    while [ -z "${LE_EMAIL}" ]; do
      read -r -p "Email for Let's Encrypt (required): " LE_EMAIL || true
      LE_EMAIL="${LE_EMAIL// /}"
    done
  fi
fi

log "[1/12] Installing prerequisites..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git openssl jq

log "[2/12] Installing Docker (if needed)..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
# docker compose v2
if ! docker compose version >/dev/null 2>&1; then
  err "Docker Compose v2 is required (docker compose ...)."
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now docker >/dev/null 2>&1 || true
fi

if [ "${USE_SSL}" = "yes" ]; then
  log "[3/12] Installing certbot..."
  apt-get install -y certbot
fi

log "[4/12] Preparing install dir: ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
if [ -d "${INSTALL_DIR}/.git" ]; then
  log "Repo already exists, pulling latest..."
  (cd "${INSTALL_DIR}" && git pull)
elif [ -f "${INSTALL_DIR}/docker-compose.yml" ] && [ -f "${INSTALL_DIR}/installer/install.sh" ]; then
  log "Using local source at ${INSTALL_DIR} (no .git metadata)."
elif [ -z "$(ls -A "${INSTALL_DIR}" 2>/dev/null)" ]; then
  log "Cloning repo..."
  if [ -n "${BRANCH}" ]; then
    git clone --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
  else
    git clone "${REPO_URL}" "${INSTALL_DIR}"
  fi
else
  err "INSTALL_DIR=${INSTALL_DIR} exists and is not empty, but is not a Guardino source directory."
  err "Use an empty INSTALL_DIR or point INSTALL_DIR to a valid Guardino source path."
  exit 1
fi
cd "${INSTALL_DIR}"

log "[5/12] Generating .env..."
if [ ! -f .env ]; then
  cp .env.example .env
fi

# Ensure core vars exist / are safe for production
# - Strong DB password
# - Strong SECRET_KEY
# - Correct DATABASE_URL
# - Frontend should call /api behind nginx

ensure_kv() {
  local key="$1"; local val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s#^${key}=.*#${key}=${val}#" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true)"
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true)"
POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2- || true)"

POSTGRES_DB="${POSTGRES_DB:-guardino}"
POSTGRES_USER="${POSTGRES_USER:-guardino}"

if [ -z "${POSTGRES_PASSWORD}" ] || [ "${POSTGRES_PASSWORD}" = "guardino" ]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 16)"
fi

SECRET_KEY="$(grep -E '^SECRET_KEY=' .env | cut -d= -f2- || true)"
if [ -z "${SECRET_KEY}" ] || [ "${SECRET_KEY}" = "please-change-me" ]; then
  SECRET_KEY="$(openssl rand -hex 32)"
fi

ensure_kv "ENV" "prod"
ensure_kv "POSTGRES_DB" "${POSTGRES_DB}"
ensure_kv "POSTGRES_USER" "${POSTGRES_USER}"
ensure_kv "POSTGRES_PASSWORD" "${POSTGRES_PASSWORD}"
ensure_kv "SECRET_KEY" "${SECRET_KEY}"
ensure_kv "REDIS_URL" "redis://redis:6379/0"
ensure_kv "USAGE_SYNC_SECONDS" "60"
ensure_kv "EXPIRY_SYNC_SECONDS" "60"
ensure_kv "USAGE_SYNC_BATCH_SIZE" "2000"
ensure_kv "EXPIRY_SYNC_BATCH_SIZE" "500"
ensure_kv "HTTP_TIMEOUT_SECONDS" "20"
ensure_kv "PANEL_TLS_VERIFY" "true"
ensure_kv "NEXT_PUBLIC_API_BASE" "/api"

# For same-origin requests, CORS can be empty. If you want to call API directly, uncomment.
if [ -n "${DOMAIN}" ]; then
  ensure_kv "CORS_ORIGINS" "http://${DOMAIN},https://${DOMAIN}"
else
  ensure_kv "CORS_ORIGINS" ""
fi

DATABASE_URL="postgresql+psycopg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}"
ensure_kv "DATABASE_URL" "${DATABASE_URL}"

log "[6/12] Writing nginx config..."
mkdir -p deploy/certbot/www

write_nginx_http() {
  local server_name="$1"
  cat > deploy/nginx.conf <<CONF
server {
  listen 80;
  server_name ${server_name};

  # Let's Encrypt challenge (served from host dir: ./deploy/certbot/www)
  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location /health {
    proxy_pass http://api:8000/health;
    proxy_set_header Host \$host;
  }

  location = /api/docs {
    proxy_pass http://api:8000/docs;
    proxy_set_header Host \$host;
  }

  location = /api/openapi.json {
    proxy_pass http://api:8000/openapi.json;
    proxy_set_header Host \$host;
  }

  location = /api/redoc {
    proxy_pass http://api:8000/redoc;
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
  cat > deploy/nginx.conf <<CONF
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

  # keep API reachable on HTTP too (helps install health checks)
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
    proxy_pass http://api:8000/docs;
    proxy_set_header Host \$host;
  }

  location = /api/openapi.json {
    proxy_pass http://api:8000/openapi.json;
    proxy_set_header Host \$host;
  }

  location = /api/redoc {
    proxy_pass http://api:8000/redoc;
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


if [ -n "${DOMAIN}" ]; then
  write_nginx_http "${DOMAIN}"
else
  write_nginx_http "_"
fi

# Some ZIP/edit workflows may accidentally join this line:
#   ./deploy/certbot/www:/var/www/certbot:rovolumes:
# which breaks compose parsing. Auto-fix before validation.
if grep -q 'certbot/www:/var/www/certbot:rovolumes:' docker-compose.yml; then
  warn "Detected malformed nginx certbot volume entry in docker-compose.yml; auto-fixing..."
  sed -i 's#certbot/www:/var/www/certbot:rovolumes:#certbot/www:/var/www/certbot:ro\
volumes:#' docker-compose.yml
fi

log "[7/12] Validating docker compose config..."
docker compose -f docker-compose.yml config >/dev/null

COMPOSE_BASE=(docker compose -f docker-compose.yml)
COMPOSE_SSL=(docker compose -f docker-compose.yml -f deploy/docker-compose.ssl.yml)

log "[8/12] Starting services (initial)..."
if [ "${RESET_DATA}" = "1" ]; then
  warn "RESET_DATA=1 -> removing volumes (database will be wiped)"
  "${COMPOSE_BASE[@]}" down -v --remove-orphans || true
else
  "${COMPOSE_BASE[@]}" down --remove-orphans || true
fi

# Start without SSL first, so certbot can validate via HTTP
"${COMPOSE_BASE[@]}" up -d --build

if [ "${USE_SSL}" = "yes" ]; then
  log "[9/12] Requesting Let's Encrypt certificate for ${DOMAIN}..."
  # certbot webroot: the token files are written to ./deploy/certbot/www
  certbot certonly \
    --webroot -w "${INSTALL_DIR}/deploy/certbot/www" \
    -d "${DOMAIN}" \
    --email "${LE_EMAIL}" \
    --agree-tos --non-interactive \
    --keep-until-expiring

  log "Certificate issued. Switching nginx to HTTPS..."
  write_nginx_https "${DOMAIN}"

  # Bring up with SSL overlay (adds 443 + mounts /etc/letsencrypt)
  "${COMPOSE_SSL[@]}" up -d --no-build --force-recreate nginx

  log "Setting up cert renewal cron..."
  DOCKER_BIN="$(command -v docker)"
  cat > /etc/cron.d/guardino-hub-certbot <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root certbot renew --quiet --deploy-hook "${DOCKER_BIN} compose -f ${INSTALL_DIR}/docker-compose.yml -f ${INSTALL_DIR}/deploy/docker-compose.ssl.yml restart nginx"
CRON
  chmod 644 /etc/cron.d/guardino-hub-certbot
fi

# Use proper compose for post-setup commands
if [ "${USE_SSL}" = "yes" ]; then
  COMPOSE=("${COMPOSE_SSL[@]}")
else
  COMPOSE=("${COMPOSE_BASE[@]}")
fi

log "[10/12] Waiting for API to be healthy..."
for i in $(seq 1 90); do
  if curl -fsS http://localhost/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS http://localhost/health >/dev/null 2>&1; then
  err "API did not become healthy. Showing last logs:" 
  "${COMPOSE[@]}" logs -n 200 --no-color api || true
  exit 1
fi

log "[11/12] Running migrations..."
"${COMPOSE[@]}" run --rm api alembic upgrade head

log "[12/12] Creating superadmin (if not exists)..."
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-ChangeMe_123!}"
"${COMPOSE[@]}" run --rm api python -m app.cli create-superadmin --username "${ADMIN_USER}" --password "${ADMIN_PASS}" || true

BASE_URL="http://$(curl -fsS ifconfig.me 2>/dev/null || echo "<server-ip>")"
if [ "${USE_SSL}" = "yes" ]; then
  BASE_URL="https://${DOMAIN}"
elif [ -n "${DOMAIN}" ]; then
  BASE_URL="http://${DOMAIN}"
fi

log "Done."
echo "----------------------------------------"
echo "URL:        ${BASE_URL}/"
echo "API docs:   ${BASE_URL}/api/docs"
echo "Health:     ${BASE_URL}/health"
echo "Superadmin: ${ADMIN_USER} / ${ADMIN_PASS}"
echo "----------------------------------------"
