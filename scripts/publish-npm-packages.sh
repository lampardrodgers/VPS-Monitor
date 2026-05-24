#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! npm whoami >/tmp/vpsmonitor-npm-whoami 2>/tmp/vpsmonitor-npm-whoami.err; then
  echo "npm is not logged in. Run: npm login" >&2
  cat /tmp/vpsmonitor-npm-whoami.err >&2 || true
  exit 1
fi

echo "Publishing as npm user: $(cat /tmp/vpsmonitor-npm-whoami)"
npm publish "$ROOT_DIR/npm/vpsmonitor-main" --access public
npm publish "$ROOT_DIR/npm/vpsmonitor-sub" --access public
