#!/usr/bin/env bash
set -euo pipefail

PACKAGE_SPEC="${PACKAGE_SPEC:-git+https://github.com/yourname/VPSMonitor.git#subdirectory=packages/controller}"
AGENT_PACKAGE_SPEC="${AGENT_PACKAGE_SPEC:-git+https://github.com/yourname/VPSMonitor.git#subdirectory=packages/agent}"
AGENT_INSTALL_SCRIPT_URL="${AGENT_INSTALL_SCRIPT_URL:-https://raw.githubusercontent.com/yourname/VPSMonitor/main/scripts/install-agent.sh}"
SUB_NPM_PACKAGE="${SUB_NPM_PACKAGE:-@sunjiehao/vpsmonitor-sub}"
CONFIG_PATH="${CONFIG_PATH:-/etc/vpsmonitor/controller.yaml}"
APP_DIR="${APP_DIR:-/opt/vpsmonitor/controller}"
AGENT_APP_DIR="${AGENT_APP_DIR:-/opt/vpsmonitor/agent}"
AGENT_CONFIG_PATH="${AGENT_CONFIG_PATH:-/etc/vpsmonitor/agent.yaml}"
DATA_DIR="${DATA_DIR:-/var/lib/vpsmonitor}"
SERVICE_USER="${SERVICE_USER:-vpsmonitor}"
SELF_AGENT_USER="${SELF_AGENT_USER:-root}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
PUBLIC_URL="${VPSMON_PUBLIC_URL:-}"
INSTALL_SELF_AGENT="${INSTALL_SELF_AGENT:-1}"
SELF_NODE_ID="${SELF_NODE_ID:-main-controller}"
SELF_NODE_NAME="${SELF_NODE_NAME:-Main Controller}"
SELF_NODE_PROVIDER="${SELF_NODE_PROVIDER:-self-hosted}"
SELF_NODE_COUNTRY="${SELF_NODE_COUNTRY:-}"
SELF_NODE_QUOTA_GB="${SELF_NODE_QUOTA_GB:-}"
SELF_CHECK_INTERVAL_SECONDS="${SELF_CHECK_INTERVAL_SECONDS:-900}"
CREATE_APP_TOKEN="${CREATE_APP_TOKEN:-1}"
INFO_PATH="${INFO_PATH:-/root/vpsmonitor-install-info.txt}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

if [[ -z "$PUBLIC_URL" && -t 0 ]]; then
  read -r -p "Public controller URL, e.g. https://monitor.example.com: " PUBLIC_URL
fi

if [[ -z "$PUBLIC_URL" ]]; then
  echo "Set VPSMON_PUBLIC_URL, for example: VPSMON_PUBLIC_URL=https://monitor.example.com" >&2
  exit 1
fi

install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y python3 python3-venv ca-certificates vnstat iproute2 qrencode
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 python3-pip ca-certificates vnstat iproute qrencode
  elif command -v yum >/dev/null 2>&1; then
    yum install -y python3 python3-pip ca-certificates vnstat iproute qrencode
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache python3 py3-pip ca-certificates vnstat iproute2 qrencode
  else
    echo "Unsupported package manager. Install Python 3.11+ manually, then rerun." >&2
    exit 1
  fi
}

install_packages

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$(dirname "$CONFIG_PATH")"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/python" -m pip install --upgrade pip
"$APP_DIR/venv/bin/python" -m pip install --upgrade "$PACKAGE_SPEC"

if [[ ! -f "$CONFIG_PATH" ]]; then
  cat > "$CONFIG_PATH" <<YAML
database: $DATA_DIR/controller.sqlite3

alerts:
  stale_after_minutes: 45
  disk_warning_percent: 15
  traffic_warning_percent: 25
  traffic_critical_percent: 10
  forecast_days: 7
  forecast_window_days: 3

notifications:
  telegram:
    enabled: false
    bot_token_env: TELEGRAM_BOT_TOKEN
    chat_id_env: TELEGRAM_CHAT_ID
  bark:
    enabled: false
    url_env: BARK_URL
YAML
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
chown root:"$SERVICE_USER" "$CONFIG_PATH"
chmod 640 "$CONFIG_PATH"

"$APP_DIR/venv/bin/vpsmon-controller" init-db --config "$CONFIG_PATH"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
"$APP_DIR/venv/bin/vpsmon-controller" print-systemd \
  --config "$CONFIG_PATH" \
  --binary "$APP_DIR/venv/bin/vpsmon-controller" \
  --user "$SERVICE_USER" \
  --host "$HOST" \
  --port "$PORT" > /tmp/vpsmon-controller.systemd

awk '/^# \/etc\/systemd\/system\/vpsmon-controller.service/{flag=1;next}/^# \/etc\/systemd\/system\/vpsmon-controller-alerts.service/{flag=0}flag' /tmp/vpsmon-controller.systemd > /etc/systemd/system/vpsmon-controller.service
awk '/^# \/etc\/systemd\/system\/vpsmon-controller-alerts.service/{flag=1;next}/^# \/etc\/systemd\/system\/vpsmon-controller-alerts.timer/{flag=0}flag' /tmp/vpsmon-controller.systemd > /etc/systemd/system/vpsmon-controller-alerts.service
awk '/^# \/etc\/systemd\/system\/vpsmon-controller-alerts.timer/{flag=1;next}/^# Enable with:/{flag=0}flag' /tmp/vpsmon-controller.systemd > /etc/systemd/system/vpsmon-controller-alerts.timer

systemctl daemon-reload
systemctl enable --now vpsmon-controller.service
systemctl enable --now vpsmon-controller-alerts.timer

if [[ "$INSTALL_SELF_AGENT" == "1" ]]; then
  mkdir -p "$AGENT_APP_DIR" "$(dirname "$AGENT_CONFIG_PATH")"
  python3 -m venv "$AGENT_APP_DIR/venv"
  "$AGENT_APP_DIR/venv/bin/python" -m pip install --upgrade pip
  "$AGENT_APP_DIR/venv/bin/python" -m pip install --upgrade "$AGENT_PACKAGE_SPEC"

  if [[ ! -f "$AGENT_CONFIG_PATH" ]]; then
    create_args=(
      create-node
      --config "$CONFIG_PATH"
      --id "$SELF_NODE_ID"
      --name "$SELF_NODE_NAME"
      --provider "$SELF_NODE_PROVIDER"
      --controller-url "http://127.0.0.1:$PORT"
      --agent-install-script-url "$AGENT_INSTALL_SCRIPT_URL"
    )
    if [[ -n "$SELF_NODE_COUNTRY" ]]; then
      create_args+=(--country "$SELF_NODE_COUNTRY")
    fi
    if [[ -n "$SELF_NODE_QUOTA_GB" ]]; then
      create_args+=(--quota-gb "$SELF_NODE_QUOTA_GB")
    fi
    self_json="$("$APP_DIR/venv/bin/vpsmon-controller" "${create_args[@]}")"
    self_token="$(SELF_JSON="$self_json" python3 - <<'PY'
import json
import os
print(json.loads(os.environ["SELF_JSON"])["node_token"])
PY
)"
    cat > "$AGENT_CONFIG_PATH" <<YAML
controller_url: http://127.0.0.1:$PORT
node_id: $SELF_NODE_ID
node_token: $self_token
interface: auto
disk_path: /
timeout_seconds: 15
YAML
    chmod 600 "$AGENT_CONFIG_PATH"
  fi

  systemctl enable --now vnstat.service || true
  "$AGENT_APP_DIR/venv/bin/vpsmon-agent" print-systemd \
    --config "$AGENT_CONFIG_PATH" \
    --binary "$AGENT_APP_DIR/venv/bin/vpsmon-agent" \
    --user "$SELF_AGENT_USER" \
    --interval-seconds "$SELF_CHECK_INTERVAL_SECONDS" > /tmp/vpsmon-agent.systemd
  awk '/^# \/etc\/systemd\/system\/vpsmon-agent.service/{flag=1;next}/^# \/etc\/systemd\/system\/vpsmon-agent.timer/{flag=0}flag' /tmp/vpsmon-agent.systemd > /etc/systemd/system/vpsmon-agent.service
  awk '/^# \/etc\/systemd\/system\/vpsmon-agent.timer/{flag=1;next}/^# Enable with:/{flag=0}flag' /tmp/vpsmon-agent.systemd > /etc/systemd/system/vpsmon-agent.timer
  systemctl daemon-reload
  systemctl enable --now vpsmon-agent.timer
fi

{
  echo "VPSMonitor controller installed"
  echo
  echo "Public URL: $PUBLIC_URL"
  echo "Web console: $PUBLIC_URL"
  echo "Controller config: $CONFIG_PATH"
  echo "Self agent config: $AGENT_CONFIG_PATH"
  echo
  echo "Recommended npm workflow:"
  echo "  vpsmonitor-main add-sub"
  echo "  vpsmonitor-main nodes"
  echo "  vpsmonitor-main delete-sub"
  echo
  echo "Low-level command to create a child VPS token:"
  echo "$APP_DIR/venv/bin/vpsmon-controller create-node --config $CONFIG_PATH --name <node-name> --id <node-id> --quota-gb <monthly-quota-gb> --controller-url $PUBLIC_URL --agent-install-script-url $AGENT_INSTALL_SCRIPT_URL --qr"
  echo
  echo "Child VPS npm install command shape:"
  echo "sudo npm i -g $SUB_NPM_PACKAGE && sudo vpsmonitor-sub install --controller-url $PUBLIC_URL --node-id <node-id> --node-token <node-token>"
  echo
  echo "View registered nodes:"
  echo "$APP_DIR/venv/bin/vpsmon-controller list-nodes --config $CONFIG_PATH"
  echo
  echo "Show these instructions again:"
  echo "cat $INFO_PATH"
  echo
  echo "Revoke a node:"
  echo "$APP_DIR/venv/bin/vpsmon-controller delete-node --config $CONFIG_PATH --id <node-id>"
} > "$INFO_PATH"
chmod 600 "$INFO_PATH"

if [[ "$CREATE_APP_TOKEN" == "1" ]]; then
  "$APP_DIR/venv/bin/vpsmon-controller" create-app-token \
    --config "$CONFIG_PATH" \
    --base-url "$PUBLIC_URL" \
    --qr | tee -a "$INFO_PATH"
fi

echo "Controller installed."
echo "Config: $CONFIG_PATH"
echo "Service: vpsmon-controller.service"
echo "Self agent: $AGENT_CONFIG_PATH"
echo "Install information: $INFO_PATH"
echo
cat "$INFO_PATH"
