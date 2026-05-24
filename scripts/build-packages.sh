#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist}"

mkdir -p "$DIST_DIR"
python3 -m pip wheel --no-deps "$ROOT_DIR/packages/controller" -w "$DIST_DIR"
python3 -m pip wheel --no-deps "$ROOT_DIR/packages/agent" -w "$DIST_DIR"

echo "Built packages:"
find "$DIST_DIR" -maxdepth 1 -type f -name 'vps_monitor_*.whl' -print | sort
