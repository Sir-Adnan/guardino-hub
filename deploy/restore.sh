#!/usr/bin/env bash
set -euo pipefail

# Usage: bash deploy/restore.sh [/opt/guardino-hub] path/to/guardino_backup_*.tar.gz
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
ARCHIVE="${2:-}"

if [ -z "${ARCHIVE}" ] || [ ! -f "${ARCHIVE}" ]; then
  echo "Provide backup archive: bash deploy/restore.sh /opt/guardino-hub backups/guardino_backup_YYYYmmddTHHMMSSZ.tar.gz"
  exit 1
fi

if [ ! -x "${ROOT}/installer/manage.sh" ]; then
  echo "ERROR: installer/manage.sh not found in ROOT=${ROOT}" 1>&2
  exit 1
fi

INSTALL_DIR="${ROOT}" bash "${ROOT}/installer/manage.sh" --restore "${ARCHIVE}"
