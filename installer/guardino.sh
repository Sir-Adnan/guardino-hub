#!/usr/bin/env bash
set -euo pipefail

# One-liner friendly installer entrypoint.
# Intended usage:
#   bash <(curl -Ls --ipv4 https://raw.githubusercontent.com/Sir-Adnan/guardino-hub/main/installer/guardino.sh)
#
# This script downloads and runs installer/install.sh from the repository.

REPO_URL_DEFAULT="https://github.com/Sir-Adnan/guardino-hub.git"
BRANCH_DEFAULT="main"
INSTALL_DIR_DEFAULT="/opt/guardino-hub"

REPO_URL="${REPO_URL:-$REPO_URL_DEFAULT}"
BRANCH="${BRANCH:-$BRANCH_DEFAULT}"
INSTALL_DIR="${INSTALL_DIR:-$INSTALL_DIR_DEFAULT}"

echo "Guardino Hub remote installer"
echo "REPO_URL=$REPO_URL"
echo "BRANCH=$BRANCH"
echo "INSTALL_DIR=$INSTALL_DIR"

# Ensure curl & sudo (raw ubuntu)
if ! command -v curl >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y curl
fi
if ! command -v git >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y git
fi

# Clone/pull
mkdir -p "$INSTALL_DIR"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
  cd "$INSTALL_DIR" && git pull
fi

cd "$INSTALL_DIR"
chmod +x installer/install.sh
sudo bash installer/install.sh
