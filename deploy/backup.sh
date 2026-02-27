#!/usr/bin/env bash
set -euo pipefail

# Usage: bash deploy/backup.sh [/opt/guardino-hub] [output_dir]
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
OUT="${2:-${ROOT}/backups}"

if [ ! -x "${ROOT}/installer/manage.sh" ]; then
  echo "ERROR: installer/manage.sh not found in ROOT=${ROOT}" 1>&2
  exit 1
fi

mkdir -p "${OUT}"
INSTALL_DIR="${ROOT}" BACKUP_DIR="${OUT}" bash "${ROOT}/installer/manage.sh" --backup-now
