#!/usr/bin/env bash
set -euo pipefail

# Guardino Hub Management Console
# - Interactive install/update/backup/restore menu
# - Safe backup archives for migration and disaster recovery

VERSION="2.0.0"
PROJECT_NAME="guardino-hub"
REPO_URL_DEFAULT="https://github.com/Sir-Adnan/guardino-hub.git"
BRANCH_DEFAULT="main"
DEFAULT_INSTALL_DIR="/opt/guardino-hub"
BACKUP_SCRIPT_PATH="/usr/local/bin/guardino-hub-backup.sh"
BACKUP_CRON_TAG="# guardino-hub-backup"
TELEGRAM_CONFIG_FILE="/etc/guardino-hub/telegram-backup.env"
TELEGRAM_PREFIX_DEFAULT="GuardinoHub"

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
BACKUP_DIR_DEFAULT="${BACKUP_DIR:-${INSTALL_DIR}/backups}"
BACKUP_FILE_GLOB="guardino_backup_*.tar.gz"

SILENT="0"
BACKUP_MODE="${BACKUP_MODE:-full}"
TELEGRAM_AUTO_UPLOAD="${TELEGRAM_AUTO_UPLOAD:-0}"
LAST_BACKUP_ARCHIVE=""

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GREY='\033[0;90m'
NC='\033[0m'

log_info() { [ "${SILENT}" = "1" ] || echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok() { [ "${SILENT}" = "1" ] || echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { [ "${SILENT}" = "1" ] || echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err() { echo -e "${RED}[ERR]${NC} $*" 1>&2; }

pause_prompt() {
  [ "${SILENT}" = "1" ] && return 0
  echo ""
  read -r -p "Press Enter to continue..."
}

ensure_root() {
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    log_err "This script requires root privileges."
    exit 1
  fi
  exec sudo -E bash "$0" "$@"
}

need_cmd() {
  local c="$1"
  if ! command -v "$c" >/dev/null 2>&1; then
    log_err "Required command not found: $c"
    exit 1
  fi
}

ensure_docker_ready() {
  need_cmd docker
  if ! docker compose version >/dev/null 2>&1; then
    log_err "Docker Compose v2 is required (docker compose ...)."
    exit 1
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
}

ensure_cron_ready() {
  if ! command -v crontab >/dev/null 2>&1; then
    log_info "Installing cron..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y >/dev/null
    apt-get install -y cron >/dev/null
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now cron >/dev/null 2>&1 || true
  fi
}

sanitize_prefix() {
  local in="${1:-}"
  local clean
  clean="$(printf "%s" "${in}" | tr -cd 'a-zA-Z0-9._-')"
  if [ -z "${clean}" ]; then
    clean="${TELEGRAM_PREFIX_DEFAULT}"
  fi
  echo "${clean}"
}

shell_single_quote_escape() {
  printf "%s" "${1:-}" | sed "s/'/'\"'\"'/g"
}

load_telegram_config() {
  TG_BOT_TOKEN="${TG_BOT_TOKEN:-}"
  TG_CHAT_ID="${TG_CHAT_ID:-}"
  TG_PREFIX="${TG_PREFIX:-}"
  TG_MODE="${TG_MODE:-}"
  if [ -f "${TELEGRAM_CONFIG_FILE}" ]; then
    # shellcheck disable=SC1090
    source "${TELEGRAM_CONFIG_FILE}"
  fi
  TG_PREFIX="$(sanitize_prefix "${TG_PREFIX:-${TELEGRAM_PREFIX_DEFAULT}}")"
  TG_MODE="${TG_MODE:-full}"
}

save_telegram_config() {
  local token="$1"
  local chat_id="$2"
  local prefix="$3"
  local mode="$4"
  mkdir -p "$(dirname "${TELEGRAM_CONFIG_FILE}")"
  local e_token e_chat e_prefix e_mode
  e_token="$(shell_single_quote_escape "${token}")"
  e_chat="$(shell_single_quote_escape "${chat_id}")"
  e_prefix="$(shell_single_quote_escape "$(sanitize_prefix "${prefix}")")"
  e_mode="$(shell_single_quote_escape "${mode}")"
  cat > "${TELEGRAM_CONFIG_FILE}" <<EOF
TG_BOT_TOKEN='${e_token}'
TG_CHAT_ID='${e_chat}'
TG_PREFIX='${e_prefix}'
TG_MODE='${e_mode}'
EOF
  chmod 600 "${TELEGRAM_CONFIG_FILE}"
}

is_telegram_configured() {
  load_telegram_config
  [ -n "${TG_BOT_TOKEN}" ] && [ -n "${TG_CHAT_ID}" ]
}

verify_telegram_connection() {
  local token="$1"
  local chat_id="$2"
  local text="$3"
  local resp
  resp="$(curl -fsS --connect-timeout 10 --max-time 20 \
    -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    -d "chat_id=${chat_id}" \
    --data-urlencode "text=${text}" 2>/dev/null || true)"
  [[ "${resp}" == *"\"ok\":true"* ]]
}

upload_backup_to_telegram() {
  local archive="$1"
  local mode="${2:-full}"
  load_telegram_config
  if [ -z "${TG_BOT_TOKEN}" ] || [ -z "${TG_CHAT_ID}" ]; then
    log_err "Telegram upload requested, but bot config is missing."
    return 1
  fi
  if [ ! -f "${archive}" ]; then
    log_err "Backup file not found for Telegram upload: ${archive}"
    return 1
  fi

  local server_ip date_now size_h file_name caption resp
  server_ip="$(detect_public_ip)"
  date_now="$(date -u +'%Y-%m-%d %H:%M UTC')"
  size_h="$(du -h "${archive}" | awk '{print $1}')"
  file_name="$(basename "${archive}")"
  caption="🔐 <b>Guardino Backup (${mode})</b>
━━━━━━━━━━━━━━━━━━
🏷 <b>Server:</b> <code>${TG_PREFIX}</code>
🌍 <b>IP:</b> <code>${server_ip:-n/a}</code>
📅 <b>Time:</b> <code>${date_now}</code>
📦 <b>Size:</b> <code>${size_h}</code>
🗂 <b>File:</b> <code>${file_name}</code>
━━━━━━━━━━━━━━━━━━
✅ <i>Backup completed successfully.</i>"

  log_info "Uploading backup to Telegram..."
  resp="$(curl -sS --connect-timeout 15 --max-time 1800 \
    -F "chat_id=${TG_CHAT_ID}" \
    -F "caption=${caption}" \
    -F "parse_mode=HTML" \
    -F "document=@${archive}" \
    "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument" || true)"
  if [[ "${resp}" == *"\"ok\":true"* ]]; then
    log_ok "Telegram upload completed."
    return 0
  fi
  log_err "Telegram upload failed."
  if [ -n "${resp}" ]; then
    log_err "Telegram response: ${resp}"
  fi
  return 1
}

compose_base() {
  docker compose -f "${INSTALL_DIR}/docker-compose.yml" "$@"
}

compose_effective() {
  if [ -f "${INSTALL_DIR}/deploy/docker-compose.ssl.yml" ] && grep -q "listen 443" "${INSTALL_DIR}/deploy/nginx.conf" 2>/dev/null; then
    docker compose -f "${INSTALL_DIR}/docker-compose.yml" -f "${INSTALL_DIR}/deploy/docker-compose.ssl.yml" "$@"
  else
    docker compose -f "${INSTALL_DIR}/docker-compose.yml" "$@"
  fi
}

is_source_ready() {
  [ -f "${INSTALL_DIR}/docker-compose.yml" ] && [ -f "${INSTALL_DIR}/installer/install.sh" ]
}

ensure_git_installed() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi
  log_info "Installing git..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null
  apt-get install -y git >/dev/null
}

ensure_source_tree() {
  if is_source_ready; then
    return 0
  fi
  ensure_git_installed
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  if [ -d "${INSTALL_DIR}/.git" ]; then
    log_info "Updating existing source: ${INSTALL_DIR}"
    (cd "${INSTALL_DIR}" && git pull --ff-only >/dev/null 2>&1 || true)
  else
    if [ -d "${INSTALL_DIR}" ] && [ -n "$(ls -A "${INSTALL_DIR}" 2>/dev/null || true)" ]; then
      log_err "INSTALL_DIR=${INSTALL_DIR} exists and is not empty."
      log_err "Set INSTALL_DIR to an empty path or an existing Guardino source path."
      exit 1
    fi
    log_info "Cloning source into ${INSTALL_DIR} ..."
    git clone --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}" >/dev/null
  fi
}

env_get() {
  local key="$1"
  local default_val="${2:-}"
  local env_file="${INSTALL_DIR}/.env"
  if [ ! -f "${env_file}" ]; then
    echo "${default_val}"
    return 0
  fi
  local raw
  raw="$(grep -E "^${key}=" "${env_file}" | tail -n1 | cut -d= -f2- || true)"
  if [ -z "${raw}" ]; then
    echo "${default_val}"
  else
    echo "${raw}"
  fi
}

detect_public_ip() {
  local ip
  ip="$(curl -fsS --max-time 2 https://api.ipify.org 2>/dev/null || true)"
  if [[ "${ip}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "${ip}"
    return 0
  fi
  ip="$(curl -fsS --max-time 2 https://ipv4.icanhazip.com 2>/dev/null | tr -d '\r\n' || true)"
  if [[ "${ip}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "${ip}"
    return 0
  fi
  hostname -I 2>/dev/null | awk '{print $1}'
}

is_stack_running() {
  if ! is_source_ready; then
    return 1
  fi
  if ! compose_effective ps --status running >/dev/null 2>&1; then
    return 1
  fi
  compose_effective ps --status running 2>/dev/null | grep -qE ' api | web | nginx '
}

is_backup_scheduled() {
  crontab -l 2>/dev/null | grep -F "${BACKUP_SCRIPT_PATH}" >/dev/null 2>&1
}

draw_logo() {
  clear
  echo -e "${CYAN}"
  echo "   ____                  ___            "
  echo "  / ___| __ _ _   _ _ __|_ _|_ __   ___ "
  echo " | |  _ / _\` | | | | '__|| || '_ \ / _ \\"
  echo " | |_| | (_| | |_| | |   | || | | |  __/"
  echo "  \____|\__,_|\__,_|_|  |___|_| |_|\___|"
  echo -e "${NC}"
  echo -e "  ${WHITE}Guardino Hub Manager${NC} ${GREY}v${VERSION}${NC}"
  echo ""
}

draw_dashboard() {
  local ip ram load panel_status health backup_status
  ip="$(detect_public_ip)"
  ram="$(free -h 2>/dev/null | awk '/Mem:/ {print $3 "/" $2}' || echo "n/a")"
  load="$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo "n/a")"

  panel_status="${RED}offline${NC}"
  health="${GREY}n/a${NC}"
  if is_stack_running; then
    panel_status="${GREEN}online${NC}"
    if curl -fsS --max-time 3 http://localhost/health >/dev/null 2>&1; then
      health="${GREEN}healthy${NC}"
    else
      health="${YELLOW}degraded${NC}"
    fi
  fi

  if is_backup_scheduled && is_telegram_configured; then
    backup_status="${GREEN}telegram-scheduled${NC}"
  elif is_backup_scheduled; then
    backup_status="${GREEN}local-scheduled${NC}"
  elif is_telegram_configured; then
    backup_status="${YELLOW}telegram-ready${NC}"
  else
    backup_status="${GREY}disabled${NC}"
  fi

  echo -e "${CYAN}==============================================================${NC}"
  printf " IP: %-22b RAM: %-20b\n" "${WHITE}${ip:-n/a}${NC}" "${WHITE}${ram}${NC}"
  printf " Load: %-20b Stack: %-18b\n" "${WHITE}${load}${NC}" "${panel_status}"
  printf " API Health: %-14b Backup: %-17b\n" "${health}" "${backup_status}"
  echo -e "${CYAN}==============================================================${NC}"
  echo ""
}

print_item() {
  local id="$1"
  local title="$2"
  local desc="$3"
  printf " ${GREEN}[%s]${NC} ${CYAN}%-18s${NC} ${GREY}%s${NC}\n" "${id}" "${title}" "${desc}"
}

assert_source_ready_or_fail() {
  if is_source_ready; then
    return 0
  fi
  log_err "Guardino source not found in INSTALL_DIR=${INSTALL_DIR}"
  log_err "Run Install first."
  return 1
}

wait_for_db() {
  local db_user="$1"
  local db_name="$2"
  local i
  for i in $(seq 1 60); do
    if compose_base exec -T db pg_isready -U "${db_user}" -d "${db_name}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [ -f "${src}" ]; then
    mkdir -p "$(dirname "${dst}")"
    cp -a "${src}" "${dst}"
  fi
}

create_backup_archive() {
  assert_source_ready_or_fail
  ensure_docker_ready

  local mode="${1:-${BACKUP_MODE}}"
  local out_dir="${2:-${BACKUP_DIR_DEFAULT}}"
  mode="$(printf "%s" "${mode}" | tr '[:upper:]' '[:lower:]')"
  if [ "${mode}" != "full" ] && [ "${mode}" != "essential" ]; then
    log_warn "Invalid backup mode '${mode}', using full."
    mode="full"
  fi

  mkdir -p "${out_dir}"

  local ts backup_name tmp_root work_dir archive
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_name="guardino_backup_${ts}"
  tmp_root="$(mktemp -d)"
  work_dir="${tmp_root}/${backup_name}"
  archive="${out_dir}/${backup_name}.tar.gz"

  mkdir -p "${work_dir}/project" "${work_dir}/database" "${work_dir}/meta"

  log_info "Collecting project config files..."
  copy_if_exists "${INSTALL_DIR}/.env" "${work_dir}/project/.env"
  copy_if_exists "${INSTALL_DIR}/docker-compose.yml" "${work_dir}/project/docker-compose.yml"
  copy_if_exists "${INSTALL_DIR}/deploy/docker-compose.ssl.yml" "${work_dir}/project/deploy/docker-compose.ssl.yml"
  copy_if_exists "${INSTALL_DIR}/deploy/nginx.conf" "${work_dir}/project/deploy/nginx.conf"

  if [ "${mode}" = "full" ] && [ -d "${INSTALL_DIR}/deploy/certbot" ]; then
    mkdir -p "${work_dir}/project/deploy"
    cp -a "${INSTALL_DIR}/deploy/certbot" "${work_dir}/project/deploy/certbot"
  fi

  local db_user db_name db_dump_file globals_dump_file
  db_user="$(env_get POSTGRES_USER guardino)"
  db_name="$(env_get POSTGRES_DB guardino)"
  db_dump_file="${work_dir}/database/db.sql"
  globals_dump_file="${work_dir}/database/globals.sql"

  log_info "Ensuring database container is running..."
  compose_base up -d db >/dev/null
  if ! wait_for_db "${db_user}" "${db_name}"; then
    rm -rf "${tmp_root}"
    log_err "Database is not ready; backup aborted."
    return 1
  fi

  log_info "Dumping PostgreSQL database (${db_name})..."
  if ! compose_base exec -T db pg_dump -U "${db_user}" -d "${db_name}" --no-owner --no-privileges > "${db_dump_file}"; then
    rm -rf "${tmp_root}"
    log_err "Database dump failed; backup aborted."
    return 1
  fi
  gzip -9 "${db_dump_file}"

  if compose_base exec -T db pg_dumpall -U "${db_user}" --globals-only > "${globals_dump_file}" 2>/dev/null; then
    gzip -9 "${globals_dump_file}"
  else
    rm -f "${globals_dump_file}"
  fi

  if [ "${mode}" = "full" ] && [ -d "/etc/letsencrypt" ]; then
    log_info "Archiving LetsEncrypt data..."
    tar -C / -czf "${work_dir}/project/letsencrypt.tar.gz" etc/letsencrypt var/lib/letsencrypt >/dev/null 2>&1 || true
  fi

  local commit_ref
  commit_ref="$(git -C "${INSTALL_DIR}" rev-parse --short HEAD 2>/dev/null || echo "n/a")"
  cat > "${work_dir}/meta/manifest.env" <<EOF
CREATED_AT_UTC=${ts}
HOSTNAME=$(hostname)
INSTALL_DIR=${INSTALL_DIR}
PROJECT=${PROJECT_NAME}
COMMIT=${commit_ref}
POSTGRES_DB=${db_name}
POSTGRES_USER=${db_user}
BACKUP_MODE=${mode}
EOF

  log_info "Creating archive: ${archive}"
  tar -C "${tmp_root}" -czf "${archive}" "${backup_name}"
  rm -rf "${tmp_root}"

  local size_h
  size_h="$(du -h "${archive}" | awk '{print $1}')"
  log_ok "Backup completed."
  log_ok "File: ${archive}"
  log_ok "Size: ${size_h}"
  LAST_BACKUP_ARCHIVE="${archive}"

  if [ "${TELEGRAM_AUTO_UPLOAD}" = "1" ]; then
    upload_backup_to_telegram "${archive}" "${mode}"
  fi
}

select_backup_file() {
  local candidates=()
  local file
  while IFS= read -r file; do
    [ -n "${file}" ] && candidates+=("${file}")
  done < <(find "${BACKUP_DIR_DEFAULT}" /root -maxdepth 3 -type f -name "${BACKUP_FILE_GLOB}" 2>/dev/null | sort -r)

  if [ "${#candidates[@]}" -eq 0 ]; then
    log_warn "No backup archives found (${BACKUP_FILE_GLOB})."
    return 1
  fi

  echo ""
  echo -e "${WHITE}Available backups:${NC}"
  local i=1
  for file in "${candidates[@]}"; do
    printf " [%d] %s\n" "${i}" "${file}"
    i=$((i + 1))
  done
  echo ""
  read -r -p "Select backup number: " idx
  if [[ ! "${idx}" =~ ^[0-9]+$ ]] || [ "${idx}" -lt 1 ] || [ "${idx}" -gt "${#candidates[@]}" ]; then
    log_err "Invalid selection."
    return 1
  fi
  echo "${candidates[$((idx - 1))]}"
}

restore_backup_archive() {
  local archive="$1"
  if [ ! -f "${archive}" ]; then
    log_err "Backup file not found: ${archive}"
    return 1
  fi

  ensure_source_tree
  ensure_docker_ready

  local tmp_root
  tmp_root="$(mktemp -d)"
  trap 'rm -rf "${tmp_root}"' RETURN

  log_info "Extracting backup..."
  tar -xzf "${archive}" -C "${tmp_root}"

  local root_dir
  root_dir="$(find "${tmp_root}" -mindepth 1 -maxdepth 1 -type d | head -n1 || true)"
  if [ -z "${root_dir}" ] || [ ! -f "${root_dir}/database/db.sql.gz" ]; then
    log_err "Invalid backup structure: database/db.sql.gz is missing."
    return 1
  fi

  local do_confirm="${2:-1}"
  if [ "${do_confirm}" = "1" ]; then
    echo ""
    log_warn "Restore will overwrite current Guardino database and config."
    read -r -p "Type RESTORE to continue: " confirm
    if [ "${confirm}" != "RESTORE" ]; then
      log_warn "Restore cancelled."
      return 1
    fi
  fi

  log_info "Stopping stack..."
  compose_effective down --remove-orphans >/dev/null 2>&1 || true

  log_info "Restoring project config files..."
  copy_if_exists "${root_dir}/project/.env" "${INSTALL_DIR}/.env"
  copy_if_exists "${root_dir}/project/docker-compose.yml" "${INSTALL_DIR}/docker-compose.yml"
  copy_if_exists "${root_dir}/project/deploy/docker-compose.ssl.yml" "${INSTALL_DIR}/deploy/docker-compose.ssl.yml"
  copy_if_exists "${root_dir}/project/deploy/nginx.conf" "${INSTALL_DIR}/deploy/nginx.conf"

  if [ -d "${root_dir}/project/deploy/certbot" ]; then
    mkdir -p "${INSTALL_DIR}/deploy"
    rm -rf "${INSTALL_DIR}/deploy/certbot"
    cp -a "${root_dir}/project/deploy/certbot" "${INSTALL_DIR}/deploy/certbot"
  fi

  if [ -f "${root_dir}/project/letsencrypt.tar.gz" ]; then
    log_info "Restoring LetsEncrypt data..."
    tar -C / -xzf "${root_dir}/project/letsencrypt.tar.gz" >/dev/null 2>&1 || true
  fi

  local db_user db_name
  db_user="$(env_get POSTGRES_USER guardino)"
  db_name="$(env_get POSTGRES_DB guardino)"

  # Reset DB volume to ensure PostgreSQL initializes with restored .env credentials.
  compose_base down -v --remove-orphans >/dev/null 2>&1 || true

  log_info "Starting database services..."
  compose_base up -d db redis >/dev/null
  if ! wait_for_db "${db_user}" "${db_name}"; then
    log_err "Database did not become ready."
    return 1
  fi

  log_info "Recreating database ${db_name}..."
  compose_base exec -T db psql -U "${db_user}" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db_name}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  compose_base exec -T db psql -U "${db_user}" -d postgres -c "DROP DATABASE IF EXISTS \"${db_name}\";" >/dev/null
  compose_base exec -T db psql -U "${db_user}" -d postgres -c "CREATE DATABASE \"${db_name}\";" >/dev/null

  if [ -f "${root_dir}/database/globals.sql.gz" ]; then
    log_info "Restoring PostgreSQL globals..."
    gunzip -c "${root_dir}/database/globals.sql.gz" | compose_base exec -T db psql -U "${db_user}" -d postgres >/dev/null 2>&1 || true
  fi

  log_info "Restoring database data..."
  gunzip -c "${root_dir}/database/db.sql.gz" | compose_base exec -T db psql -U "${db_user}" -d "${db_name}" >/dev/null

  log_info "Starting full stack..."
  compose_effective up -d --build

  log_info "Applying migrations..."
  compose_effective run --rm api alembic upgrade head >/dev/null

  log_ok "Restore completed successfully."
}

ask_backup_frequency() {
  echo ""
  echo " [1] Every 30 minutes"
  echo " [2] Every X hours"
  echo " [3] Daily at fixed hour"
  echo ""
  read -r -p "Select backup frequency: " freq

  local cron_expr
  case "${freq}" in
    1)
      cron_expr="*/30 * * * *"
      ;;
    2)
      read -r -p "Enter hours (1-23): " every_hours
      if [[ ! "${every_hours:-}" =~ ^[0-9]+$ ]] || [ "${every_hours}" -lt 1 ] || [ "${every_hours}" -gt 23 ]; then
        log_warn "Invalid value; defaulting to every 1 hour."
        every_hours=1
      fi
      cron_expr="0 */${every_hours} * * *"
      ;;
    3)
      read -r -p "Hour (0-23): " at_hour
      if [[ ! "${at_hour:-}" =~ ^[0-9]+$ ]] || [ "${at_hour}" -lt 0 ] || [ "${at_hour}" -gt 23 ]; then
        log_warn "Invalid value; defaulting to 03:00."
        at_hour=3
      fi
      cron_expr="0 ${at_hour} * * *"
      ;;
    *)
      log_warn "Unknown option; defaulting to daily 03:00."
      cron_expr="0 3 * * *"
      ;;
  esac
  echo "${cron_expr}"
}

write_backup_wrapper() {
  local mode="${1:-full}"
  local telegram_upload="${2:-0}"
  local telegram_flag=""
  if [ "${telegram_upload}" = "1" ]; then
    telegram_flag="--telegram-upload"
  fi
  cat > "${BACKUP_SCRIPT_PATH}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR}" BACKUP_DIR="${BACKUP_DIR_DEFAULT}" BACKUP_MODE="${mode}" TELEGRAM_AUTO_UPLOAD="${telegram_upload}" bash "${INSTALL_DIR}/installer/manage.sh" --backup-now --silent --backup-mode "${mode}" ${telegram_flag}
EOF
  chmod +x "${BACKUP_SCRIPT_PATH}"
}

install_backup_cron() {
  local cron_expr="$1"
  (crontab -l 2>/dev/null | grep -vF "${BACKUP_SCRIPT_PATH}" | grep -vF "${BACKUP_CRON_TAG}" || true) | crontab -
  (crontab -l 2>/dev/null; echo "${cron_expr} ${BACKUP_SCRIPT_PATH} ${BACKUP_CRON_TAG}") | crontab -
}

set_backup_schedule() {
  assert_source_ready_or_fail
  ensure_cron_ready
  local cron_expr
  cron_expr="$(ask_backup_frequency)"
  write_backup_wrapper "full" "0"
  install_backup_cron "${cron_expr}"
  log_ok "Backup schedule saved."

  log_info "Running a backup test..."
  bash "${BACKUP_SCRIPT_PATH}"
}

setup_telegram_backup() {
  local mode="${1:-full}"
  mode="$(printf "%s" "${mode}" | tr '[:upper:]' '[:lower:]')"
  if [ "${mode}" != "full" ] && [ "${mode}" != "essential" ]; then
    mode="full"
  fi

  assert_source_ready_or_fail
  ensure_cron_ready
  need_cmd curl
  need_cmd tar
  need_cmd gzip

  load_telegram_config
  echo ""
  echo -e "${YELLOW}Telegram Backup Setup (${mode})${NC}"
  echo -e "${GREY}--------------------------------------------------------------${NC}"

  local token_in chat_in prefix_in
  read -r -p "Bot Token [current: ${TG_BOT_TOKEN:+set}]: " token_in
  read -r -p "Chat ID   [current: ${TG_CHAT_ID:-none}]: " chat_in
  read -r -p "Server Prefix [default: ${TG_PREFIX:-${TELEGRAM_PREFIX_DEFAULT}}]: " prefix_in

  local token chat prefix
  token="${token_in:-${TG_BOT_TOKEN:-}}"
  chat="${chat_in:-${TG_CHAT_ID:-}}"
  prefix="$(sanitize_prefix "${prefix_in:-${TG_PREFIX:-${TELEGRAM_PREFIX_DEFAULT}}}")"

  if [ -z "${token}" ] || [ -z "${chat}" ]; then
    log_err "Bot token and chat id are required."
    return 1
  fi

  log_info "Verifying Telegram connection..."
  if ! verify_telegram_connection "${token}" "${chat}" "✅ Guardino backup bot connected (${prefix})"; then
    log_err "Telegram verification failed. Check token/chat id."
    return 1
  fi
  log_ok "Telegram credentials verified."

  local cron_expr
  cron_expr="$(ask_backup_frequency)"

  save_telegram_config "${token}" "${chat}" "${prefix}" "${mode}"
  write_backup_wrapper "${mode}" "1"
  install_backup_cron "${cron_expr}"
  log_ok "Telegram backup schedule saved."

  TELEGRAM_AUTO_UPLOAD="1"
  BACKUP_MODE="${mode}"
  log_info "Running test backup and upload..."
  create_backup_archive "${mode}" "${BACKUP_DIR_DEFAULT}"
  log_ok "Test backup completed. Check your Telegram chat."
}

disable_backup_schedule() {
  ensure_cron_ready
  (crontab -l 2>/dev/null | grep -vF "${BACKUP_SCRIPT_PATH}" | grep -vF "${BACKUP_CRON_TAG}" || true) | crontab -
  rm -f "${BACKUP_SCRIPT_PATH}"
  rm -f "${TELEGRAM_CONFIG_FILE}"
  log_ok "Backup schedule disabled (including Telegram config)."
}

show_stack_logs() {
  if ! assert_source_ready_or_fail; then
    pause_prompt
    return 0
  fi
  ensure_docker_ready
  compose_effective logs -f --tail=100
}

show_stack_status() {
  if ! assert_source_ready_or_fail; then
    pause_prompt
    return 0
  fi
  ensure_docker_ready
  compose_effective ps
  echo ""
  curl -fsS http://localhost/health 2>/dev/null || true
  echo ""
}

run_install() {
  ensure_source_tree
  if [ ! -x "${INSTALL_DIR}/installer/install.sh" ]; then
    chmod +x "${INSTALL_DIR}/installer/install.sh"
  fi
  INSTALL_DIR="${INSTALL_DIR}" REPO_URL="${REPO_URL}" BRANCH="${BRANCH}" bash "${INSTALL_DIR}/installer/install.sh"
}

run_update() {
  if ! assert_source_ready_or_fail; then
    return 1
  fi
  if [ ! -x "${INSTALL_DIR}/installer/update.sh" ]; then
    chmod +x "${INSTALL_DIR}/installer/update.sh"
  fi
  INSTALL_DIR="${INSTALL_DIR}" bash "${INSTALL_DIR}/installer/update.sh"
}

uninstall_guardino() {
  if ! assert_source_ready_or_fail; then
    return 1
  fi
  ensure_docker_ready
  echo ""
  log_warn "This removes running services from INSTALL_DIR=${INSTALL_DIR}."
  read -r -p "Type UNINSTALL to continue: " confirm
  if [ "${confirm}" != "UNINSTALL" ]; then
    log_warn "Uninstall cancelled."
    return 1
  fi

  compose_effective down --remove-orphans >/dev/null 2>&1 || true
  disable_backup_schedule >/dev/null 2>&1 || true

  read -r -p "Delete Docker volume data too? (y/N): " wipe
  if [[ "${wipe}" =~ ^[Yy]$ ]]; then
    compose_effective down -v --remove-orphans >/dev/null 2>&1 || true
    log_ok "Volume cleanup attempted."
  fi
  log_ok "Services were removed."
}

menu_loop() {
  while true; do
    draw_logo
    draw_dashboard

    echo -e "${YELLOW}MANAGEMENT${NC}"
    print_item 1 "Install Panel" "Fresh install / repair install"
    print_item 2 "Update Panel" "Pull latest and run migrations"
    print_item 3 "Status" "Services and health"
    print_item 4 "Logs" "Follow docker logs"

    echo -e "${GREY}--------------------------------------------------------------${NC}"
    echo -e "${YELLOW}BACKUP & RESTORE${NC}"
    print_item 5 "Backup Now" "Create migration-ready archive (full)"
    print_item 6 "Setup TG (Full)" "Schedule full backup + Telegram upload"
    print_item 7 "Setup TG (Lite)" "Schedule essential backup + Telegram upload"
    print_item 8 "Schedule Local" "Cron backup without Telegram"
    print_item 10 "Restore Backup" "Restore full database + config"
    print_item 11 "Disable Backup" "Remove schedule and TG config"

    echo -e "${GREY}--------------------------------------------------------------${NC}"
    echo -e "${YELLOW}SYSTEM${NC}"
    print_item 0 "Uninstall" "Stop services and optional data wipe"
    print_item 9 "Exit" "Quit manager"

    echo ""
    read -r -p "Select option: " option

    case "${option}" in
      1) run_install; pause_prompt ;;
      2) run_update; pause_prompt ;;
      3) show_stack_status; pause_prompt ;;
      4) show_stack_logs ;;
      5) TELEGRAM_AUTO_UPLOAD="0"; create_backup_archive "full" "${BACKUP_DIR_DEFAULT}"; pause_prompt ;;
      6) setup_telegram_backup "full"; pause_prompt ;;
      7) setup_telegram_backup "essential"; pause_prompt ;;
      8) set_backup_schedule; pause_prompt ;;
      10)
        if file="$(select_backup_file)"; then
          restore_backup_archive "${file}" "1"
        fi
        pause_prompt
        ;;
      11) disable_backup_schedule; pause_prompt ;;
      0) uninstall_guardino; pause_prompt ;;
      9) clear; exit 0 ;;
      *) ;;
    esac
  done
}

main() {
  ensure_root "$@"

  local action="menu"
  local restore_file=""
  local telegram_mode="full"
  while [ "${#}" -gt 0 ]; do
    case "$1" in
      --install) action="install" ;;
      --update) action="update" ;;
      --backup-now) action="backup" ;;
      --backup-mode)
        shift
        BACKUP_MODE="${1:-full}"
        ;;
      --telegram-upload) TELEGRAM_AUTO_UPLOAD="1" ;;
      --setup-telegram-full)
        action="setup-telegram"
        telegram_mode="full"
        ;;
      --setup-telegram-lite)
        action="setup-telegram"
        telegram_mode="essential"
        ;;
      --restore)
        action="restore"
        shift
        restore_file="${1:-}"
        ;;
      --disable-backup) action="disable-backup" ;;
      --status) action="status" ;;
      --logs) action="logs" ;;
      --menu) action="menu" ;;
      --silent) SILENT="1" ;;
      *)
        log_err "Unknown argument: $1"
        exit 1
        ;;
    esac
    shift
  done

  case "${action}" in
    install) run_install ;;
    update) run_update ;;
    backup) create_backup_archive "${BACKUP_MODE}" "${BACKUP_DIR_DEFAULT}" ;;
    setup-telegram) setup_telegram_backup "${telegram_mode}" ;;
    restore)
      if [ -z "${restore_file}" ]; then
        log_err "Usage: $0 --restore /path/to/${BACKUP_FILE_GLOB}"
        exit 1
      fi
      restore_backup_archive "${restore_file}" "0"
      ;;
    disable-backup) disable_backup_schedule ;;
    status) show_stack_status ;;
    logs) show_stack_logs ;;
    menu) menu_loop ;;
    *)
      log_err "Unsupported action: ${action}"
      exit 1
      ;;
  esac
}

main "$@"
