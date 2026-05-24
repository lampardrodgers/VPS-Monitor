#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist/npm}"

mkdir -p "$DIST_DIR"
npm pack "$ROOT_DIR/npm/vpsmonitor-main" --pack-destination "$DIST_DIR"
npm pack "$ROOT_DIR/npm/vpsmonitor-sub" --pack-destination "$DIST_DIR"

echo "Built npm packages:"
find "$DIST_DIR" -maxdepth 1 -type f -name '*.tgz' -print | sort
