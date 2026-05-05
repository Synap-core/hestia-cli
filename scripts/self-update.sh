#!/usr/bin/env bash
# Update the Eve CLI installation in-place.
#
# Run from the eve install directory, or pass --dir to target a different one:
#   /opt/eve/scripts/self-update.sh
#   bash /opt/eve/scripts/self-update.sh --dir /opt/eve
#
set -euo pipefail

TARGET_DIR="${1:-}"
if [[ -z "$TARGET_DIR" ]]; then
  # Resolve the directory containing this script
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  TARGET_DIR="$(dirname "$SCRIPT_DIR")"
fi

if [[ ! -d "$TARGET_DIR/.git" ]]; then
  echo "ERROR: $TARGET_DIR is not a git repository."
  echo "Usage: $0 [/path/to/eve]"
  exit 1
fi

echo "[eve self-update] Pulling latest changes…"
git -C "$TARGET_DIR" pull --ff-only

echo "[eve self-update] Installing dependencies…"
pnpm --dir "$TARGET_DIR" install

echo "[eve self-update] Building…"
pnpm --dir "$TARGET_DIR" --filter @eve/cli... run build

# Re-link the binary so the global `eve` command picks up the new build
EVE_BIN="$TARGET_DIR/packages/eve-cli/dist/index.js"
if [[ -f "$EVE_BIN" ]]; then
  chmod +x "$EVE_BIN"
  ln -sf "$EVE_BIN" /usr/local/bin/eve
  echo "[eve self-update] Linked: /usr/local/bin/eve → $EVE_BIN"
fi

echo "[eve self-update] Done. Run 'eve --version' to confirm."
