#!/usr/bin/env bash
# Greenfield host prep: Docker, Node 20+, pnpm, clone Hestia CLI, build, then eve setup.
# Usage:
#   curl -fsSL ... | bash
#   ./bootstrap.sh [--dir /opt/eve] [--repo https://github.com/.../hestia-cli.git]
set -euo pipefail

TARGET_DIR="${EVE_BOOTSTRAP_DIR:-/opt/eve}"
REPO_URL="${EVE_BOOTSTRAP_REPO:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) TARGET_DIR="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

need_cmd() { command -v "$1" >/dev/null 2>&1; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (uses apt / Docker install when needed)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
if need_cmd apt-get; then
  apt-get update -y
  apt-get install -y ca-certificates curl git
fi

if ! need_cmd docker; then
  echo "[bootstrap] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker || true
fi

if ! need_cmd node || [[ "$(node -v 2>/dev/null | tr -d 'v' | cut -d. -f1)" -lt 20 ]]; then
  echo "[bootstrap] Installing Node.js 20.x..."
  if need_cmd apt-get; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    echo "Install Node 20+ manually, then re-run."
    exit 1
  fi
fi

corepack enable || true
if ! need_cmd pnpm; then
  npm install -g pnpm@10
fi

mkdir -p "$(dirname "$TARGET_DIR")"
if [[ ! -d "$TARGET_DIR/.git" ]]; then
  if [[ -z "$REPO_URL" ]]; then
    echo "Set EVE_BOOTSTRAP_REPO or pass --repo <git-url> to clone hestia-cli."
    exit 1
  fi
  git clone "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"
pnpm install
pnpm --filter @eve/cli... run build

echo "[bootstrap] Done. Next: cd $TARGET_DIR/packages/eve-cli && node dist/index.js setup"
