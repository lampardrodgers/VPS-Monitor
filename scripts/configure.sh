#!/usr/bin/env bash

set -euo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
cd "$project_dir"

if ! command -v uv >/dev/null 2>&1; then
  echo "未找到 uv。请先按 https://docs.astral.sh/uv/ 安装 uv。" >&2
  exit 1
fi

uv sync --frozen
exec uv run python scripts/configure.py "$@"
