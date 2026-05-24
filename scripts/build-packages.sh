#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist}"

mkdir -p "$DIST_DIR"
if [[ "${SKIP_WEB_BUILD:-0}" != "1" && -f "$ROOT_DIR/web/package.json" ]]; then
  if [[ -f "$ROOT_DIR/web/package-lock.json" ]]; then
    npm --prefix "$ROOT_DIR/web" ci
  else
    npm --prefix "$ROOT_DIR/web" install
  fi
  npm --prefix "$ROOT_DIR/web" run build
fi
rm -rf "$ROOT_DIR/packages/controller/build" "$ROOT_DIR/packages/agent/build"
find "$DIST_DIR" -maxdepth 1 -type f -name 'vps_monitor_*.whl' -delete
python3 -m pip wheel --no-deps "$ROOT_DIR/packages/controller" -w "$DIST_DIR"
python3 -m pip wheel --no-deps "$ROOT_DIR/packages/agent" -w "$DIST_DIR"

echo "Built packages:"
find "$DIST_DIR" -maxdepth 1 -type f -name 'vps_monitor_*.whl' -print | sort
