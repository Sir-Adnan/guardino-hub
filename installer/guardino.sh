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

if [ "$INSTALL_DIR" = "$LOCAL_ROOT" ]; then
  echo "Local source detected, skipping clone/pull."
else
  mkdir -p "$INSTALL_DIR"
  if [ -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR" && git pull
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
chmod +x installer/install.sh

if [ "$(id -u)" -eq 0 ]; then
  REPO_URL="$REPO_URL" BRANCH="$BRANCH" INSTALL_DIR="$INSTALL_DIR" bash installer/install.sh
else
  sudo REPO_URL="$REPO_URL" BRANCH="$BRANCH" INSTALL_DIR="$INSTALL_DIR" bash installer/install.sh
fi
