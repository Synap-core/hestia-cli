#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

VERSION="${1:-${VERSION:-}}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('./package.json').version")"
fi

echo "[bundle] preparing Eve release bundle for version: ${VERSION}"

rm -rf .release
mkdir -p .release

# Build all workspace packages first so runtime dist files are present.
pnpm -r run build

# Create a portable runtime folder for @eve/cli with production deps only.
pnpm --filter @eve/cli --prod deploy ./.release/eve

# Keep the provenance metadata next to the runtime bundle.
cp package.json pnpm-lock.yaml ./.release/eve/

BUNDLE_NAME="eve-cli-bundle-${VERSION}.tar.gz"
tar -czf ".release/${BUNDLE_NAME}" -C .release eve

echo "[bundle] created .release/${BUNDLE_NAME}"
