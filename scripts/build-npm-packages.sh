#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist/npm}"

mkdir -p "$DIST_DIR"
if [[ "${SKIP_WEB_BUILD:-0}" != "1" && -f "$ROOT_DIR/web/package.json" ]]; then
  if [[ -f "$ROOT_DIR/web/package-lock.json" ]]; then
    npm --prefix "$ROOT_DIR/web" ci
  else
    npm --prefix "$ROOT_DIR/web" install
  fi
  npm --prefix "$ROOT_DIR/web" run build
fi
npm pack "$ROOT_DIR/npm/vpsmonitor-main" --pack-destination "$DIST_DIR"
npm pack "$ROOT_DIR/npm/vpsmonitor-sub" --pack-destination "$DIST_DIR"

echo "Built npm packages:"
find "$DIST_DIR" -maxdepth 1 -type f -name '*.tgz' -print | sort
