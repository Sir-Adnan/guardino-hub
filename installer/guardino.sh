#!/usr/bin/env bash
set -euo pipefail

# One-liner:
# bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)

REPO_URL_DEFAULT="https://github.com/Sir-Adnan/guardino-hub.git"
BRANCH_DEFAULT="main"
INSTALL_DIR_DEFAULT="/opt/guardino-hub"

REPO_URL="${REPO_URL:-$REPO_URL_DEFAULT}"
BRANCH="${BRANCH:-$BRANCH_DEFAULT}"
if [ -z "${INSTALL_DIR+x}" ]; then
  INSTALL_DIR="${INSTALL_DIR_DEFAULT}"
  INSTALL_DIR_FROM_ENV="0"
else
  INSTALL_DIR="${INSTALL_DIR}"
  INSTALL_DIR_FROM_ENV="1"
fi

# If this script is executed from inside a local project folder,
# prefer local source instead of cloning from GitHub.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [ "${INSTALL_DIR_FROM_ENV}" = "0" ] && [ "${FORCE_REMOTE:-0}" != "1" ] && [ -f "${LOCAL_ROOT}/docker-compose.yml" ] && [ -f "${LOCAL_ROOT}/installer/install.sh" ]; then
  INSTALL_DIR="${LOCAL_ROOT}"
fi

echo "Guardino Hub remote installer"
echo "REPO_URL=$REPO_URL"
echo "BRANCH=$BRANCH"
echo "INSTALL_DIR=$INSTALL_DIR"

if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
  echo "ERROR: This installer needs root privileges. Run as root or install sudo."
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then
    apt-get update -y
    apt-get install -y git
  else
    sudo apt-get update -y
    sudo apt-get install -y git
  fi
fi

sync_git_source() {
  local dir="$1"
  local branch="$2"
  local repo_url="$3"

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
    echo "Local git changes backed up to: $backup_dir"
  fi

  git reset --hard "origin/$branch"

  # deploy/nginx.conf is generated per server (domain/SSL mode). Preserve it
  # across code sync, then updater/install scripts can patch known route fixes.
  if [ -n "$backup_dir" ] && [ -f "$backup_dir/files/deploy/nginx.conf" ]; then
    mkdir -p "$dir/deploy"
    cp -a "$backup_dir/files/deploy/nginx.conf" "$dir/deploy/nginx.conf"
    echo "Preserved server nginx config: deploy/nginx.conf"
  fi
}

if [ "$INSTALL_DIR" = "$LOCAL_ROOT" ]; then
  echo "Local source detected, skipping clone/pull."
else
  mkdir -p "$INSTALL_DIR"
  if [ -d "$INSTALL_DIR/.git" ]; then
    sync_git_source "$INSTALL_DIR" "$BRANCH" "$REPO_URL"
  elif [ -f "$INSTALL_DIR/docker-compose.yml" ] && [ -f "$INSTALL_DIR/installer/install.sh" ] && { [ "$INSTALL_DIR" = "$LOCAL_ROOT" ] || [ "$INSTALL_DIR_FROM_ENV" = "1" ]; }; then
    echo "Existing local source detected at $INSTALL_DIR (no .git); using it as-is."
  elif [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  else
    echo "ERROR: INSTALL_DIR=$INSTALL_DIR exists and is not a git clone of Guardino."
    echo "For remote install, use an empty INSTALL_DIR (or remove old files) and run again."
    echo "If you intentionally want local non-git source, set INSTALL_DIR explicitly to that path."
    exit 1
  fi
fi

cd "$INSTALL_DIR"
chmod +x installer/install.sh installer/update.sh installer/manage.sh installer/guardinoctl.sh

# By default run interactive management console.
# Backward-compatible shortcuts:
#   bash guardino.sh --install
#   bash guardino.sh --update
if [ "$(id -u)" -eq 0 ]; then
  REPO_URL="$REPO_URL" BRANCH="$BRANCH" INSTALL_DIR="$INSTALL_DIR" bash installer/guardinoctl.sh "$@"
else
  sudo REPO_URL="$REPO_URL" BRANCH="$BRANCH" INSTALL_DIR="$INSTALL_DIR" bash installer/guardinoctl.sh "$@"
fi
