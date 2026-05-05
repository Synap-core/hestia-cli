#!/usr/bin/env bash
# Greenfield host prep: Docker, Node 20+, pnpm, clone hestia-cli, build, then optionally run `eve setup`.
#
# Canonical repo: https://github.com/Synap-core/hestia-cli
# Default install dir: /opt/eve
#
# Minimal Debian/Ubuntu (no curl yet — install curl+git first, then fetch; run as root, no sudo):
#   export DEBIAN_FRONTEND=noninteractive
#   apt-get update -y && apt-get install -y ca-certificates curl git
#   curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | bash -s -- \
#     --repo "https://github.com/Synap-core/hestia-cli.git"
#
# One-liner (same as above chained; raw script from main):
#   DEBIAN_FRONTEND=noninteractive apt-get update -y && apt-get install -y ca-certificates curl git \
#     && curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | bash -s -- \
#     --repo "https://github.com/Synap-core/hestia-cli.git"
#
# Non-root with sudo:
#   curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | sudo bash -s -- \
#     --repo "https://github.com/Synap-core/hestia-cli.git"
#
# Pass flags to eve setup after `--` (optional; omit `--` for interactive wizard):
#   curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | bash -s -- \
#     --repo "https://github.com/Synap-core/hestia-cli.git" -- --dry-run --profile inference_only
#
# Env (alternative to --repo): EVE_BOOTSTRAP_REPO, EVE_BOOTSTRAP_DIR
# Preserve env through sudo: sudo -E bash -s -- ...
#
set -euo pipefail

TARGET_DIR="${EVE_BOOTSTRAP_DIR:-/opt/eve}"
REPO_URL="${EVE_BOOTSTRAP_REPO:-}"
NO_SETUP=0
SETUP_ARGS=()

need_cmd() { command -v "$1" >/dev/null 2>&1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      TARGET_DIR="${2:?--dir requires a path}"
      shift 2
      ;;
    --repo)
      REPO_URL="${2:?--repo requires a git URL}"
      shift 2
      ;;
    --no-setup)
      NO_SETUP=1
      shift
      ;;
    --)
      shift
      SETUP_ARGS+=("$@")
      break
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--dir /opt/eve] [--repo https://github.com/Synap-core/hestia-cli.git] [--no-setup] [-- ...eve setup args...]"
      echo "When piping from curl, pass script args after: bash -s -- --repo URL [-- eve setup flags]"
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (uses apt / Docker install when needed)."
  exit 1
fi

if [[ ! -d "$TARGET_DIR/.git" ]] && [[ -z "$REPO_URL" ]]; then
  echo "Either clone hestia-cli into $TARGET_DIR first, or pass --repo / set EVE_BOOTSTRAP_REPO, e.g.:"
  echo "  apt-get update -y && apt-get install -y ca-certificates curl git   # as root if curl is missing"
  echo "  curl -fsSL 'https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh' | bash -s -- --repo 'https://github.com/Synap-core/hestia-cli.git'"
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
    echo "Directory $TARGET_DIR is not a git repo; --repo (or EVE_BOOTSTRAP_REPO) is required to clone."
    exit 1
  fi
  git clone "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"
pnpm install
pnpm --filter @eve/cli... run build

echo "[bootstrap] Build complete in $TARGET_DIR"

# Install the `eve` binary globally so users can call it directly instead of
# going through pnpm or npx (which downloads a potentially older registry
# version). The dist file already has a Node shebang.
EVE_BIN="$TARGET_DIR/packages/eve-cli/dist/index.js"
if [[ -f "$EVE_BIN" ]]; then
  chmod +x "$EVE_BIN"
  ln -sf "$EVE_BIN" /usr/local/bin/eve
  echo "[bootstrap] Installed: eve → $EVE_BIN"
else
  echo "[bootstrap] WARNING: $EVE_BIN not found — run 'eve' via: cd $TARGET_DIR && pnpm run eve"
fi

if [[ "$NO_SETUP" -eq 1 ]]; then
  echo "[bootstrap] Skipped eve setup (--no-setup). Run: eve setup"
  exit 0
fi

if [[ ! -t 0 ]] && [[ ${#SETUP_ARGS[@]} -eq 0 ]]; then
  echo "[bootstrap] Non-interactive stdin detected; cannot run interactive eve setup from a piped bootstrap."
  echo "[bootstrap] Choose one:"
  echo "  1) Run non-interactive flags now (example):"
  echo "     curl .../bootstrap.sh | bash -s -- --repo '$REPO_URL' -- --yes --profile full"
  echo "  2) Re-run bootstrap with --no-setup, then start setup in a real TTY:"
  echo "     cd $TARGET_DIR && pnpm --filter @eve/cli exec eve setup"
  exit 2
fi

echo "[bootstrap] Launching eve setup…"
cd "$TARGET_DIR"
exec pnpm --filter @eve/cli exec eve setup "${SETUP_ARGS[@]}"
