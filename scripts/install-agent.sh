#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-install}"
PACKAGE_SPEC="${PACKAGE_SPEC:-git+https://github.com/yourname/VPSMonitor.git#subdirectory=packages/agent}"
CONFIG_PATH="${CONFIG_PATH:-/etc/vpsmonitor/agent.yaml}"
APP_DIR="${APP_DIR:-/opt/vpsmonitor/agent}"
SERVICE_USER="${SERVICE_USER:-root}"
CONTROLLER_URL="${VPSMON_CONTROLLER_URL:-}"
NODE_ID="${VPSMON_NODE_ID:-}"
NODE_TOKEN="${VPSMON_NODE_TOKEN:-}"
PAIRING_URL="${VPSMON_PAIRING_URL:-}"
INTERFACE="${VPSMON_INTERFACE:-auto}"
DISK_PATH="${VPSMON_DISK_PATH:-/}"
CHECK_INTERVAL_SECONDS="${VPSMON_CHECK_INTERVAL_SECONDS:-900}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

disconnect() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now vpsmon-agent.timer >/dev/null 2>&1 || true
    systemctl stop vpsmon-agent.service >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/vpsmon-agent.service /etc/systemd/system/vpsmon-agent.timer
    systemctl daemon-reload || true
  fi
  rm -f "$CONFIG_PATH"
  if [[ "${REMOVE_PACKAGE:-0}" == "1" ]]; then
    rm -rf "$APP_DIR"
  fi
  echo "Agent disconnected locally."
  echo "To revoke access on the controller, run:"
  echo "vpsmon-controller delete-node --config /etc/vpsmonitor/controller.yaml --id <node-id>"
}

if [[ "$ACTION" == "disconnect" || "$ACTION" == "uninstall" || "$ACTION" == "remove" ]]; then
  disconnect
  exit 0
fi

if [[ -n "$PAIRING_URL" ]]; then
  eval "$(PAIRING_URL="$PAIRING_URL" python3 - <<'PY'
from urllib.parse import parse_qs, urlparse
import os
import shlex

parsed = urlparse(os.environ["PAIRING_URL"])
query = parse_qs(parsed.query)
for source, target in (
    ("controller_url", "CONTROLLER_URL"),
    ("node_id", "NODE_ID"),
    ("node_token", "NODE_TOKEN"),
):
    values = query.get(source)
    if values:
        print(f"{target}={shlex.quote(values[0])}")
PY
)"
fi

prompt_if_missing() {
  local var_name="$1"
  local prompt="$2"
  local current="${!var_name:-}"
  if [[ -z "$current" && -t 0 ]]; then
    read -r -p "$prompt" current
    printf -v "$var_name" "%s" "$current"
  fi
}

prompt_if_missing CONTROLLER_URL "Controller URL, e.g. https://monitor.example.com: "
prompt_if_missing NODE_ID "Node ID from controller: "
prompt_if_missing NODE_TOKEN "Node token from controller: "

if [[ -z "$CONTROLLER_URL" || -z "$NODE_ID" || -z "$NODE_TOKEN" ]]; then
  echo "Missing controller information." >&2
  echo "Set VPSMON_CONTROLLER_URL, VPSMON_NODE_ID, and VPSMON_NODE_TOKEN, or set VPSMON_PAIRING_URL." >&2
  exit 1
fi

install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y python3 python3-venv ca-certificates vnstat iproute2
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 python3-pip ca-certificates vnstat iproute
  elif command -v yum >/dev/null 2>&1; then
    yum install -y python3 python3-pip ca-certificates vnstat iproute
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache python3 py3-pip ca-certificates vnstat iproute2
  else
    echo "Unsupported package manager. Install Python 3.11+ and vnStat manually, then rerun." >&2
    exit 1
  fi
}

install_packages

mkdir -p "$APP_DIR" "$(dirname "$CONFIG_PATH")"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/python" -m pip install --upgrade pip
"$APP_DIR/venv/bin/python" -m pip install --upgrade "$PACKAGE_SPEC"

cat > "$CONFIG_PATH" <<YAML
controller_url: $CONTROLLER_URL
node_id: $NODE_ID
node_token: $NODE_TOKEN
interface: $INTERFACE
disk_path: $DISK_PATH
timeout_seconds: 15
YAML
chmod 600 "$CONFIG_PATH"
if id "$SERVICE_USER" >/dev/null 2>&1; then
  chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_PATH"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now vnstat.service || true
  "$APP_DIR/venv/bin/vpsmon-agent" print-systemd \
    --config "$CONFIG_PATH" \
    --binary "$APP_DIR/venv/bin/vpsmon-agent" \
    --user "$SERVICE_USER" \
    --interval-seconds "$CHECK_INTERVAL_SECONDS" > /tmp/vpsmon-agent.systemd
  awk '/^# \/etc\/systemd\/system\/vpsmon-agent.service/{flag=1;next}/^# \/etc\/systemd\/system\/vpsmon-agent.timer/{flag=0}flag' /tmp/vpsmon-agent.systemd > /etc/systemd/system/vpsmon-agent.service
  awk '/^# \/etc\/systemd\/system\/vpsmon-agent.timer/{flag=1;next}/^# Enable with:/{flag=0}flag' /tmp/vpsmon-agent.systemd > /etc/systemd/system/vpsmon-agent.timer
  systemctl daemon-reload
  systemctl enable --now vpsmon-agent.timer
fi

echo "Agent installed."
echo "Config: $CONFIG_PATH"
echo "Run a dry report with: $APP_DIR/venv/bin/vpsmon-agent once --config $CONFIG_PATH --dry-run"
