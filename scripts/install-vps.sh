#!/usr/bin/env bash

set -euo pipefail
umask 027

readonly APP_USER="vpsmonitor"
readonly APP_GROUP="vpsmonitor"
readonly INSTALL_DIR="/opt/vpsmonitor"
readonly VENV_DIR="/opt/vpsmonitor/venv"
readonly CONFIG_DIR="/etc/vpsmonitor"
readonly CONFIG_FILE="/etc/vpsmonitor/providers.yaml"
readonly SECRETS_FILE="/etc/vpsmonitor/secrets.env"
readonly DATA_DIR="/var/lib/vpsmonitor"
readonly DATA_FILE="/var/lib/vpsmonitor/vpsmonitor.sqlite3"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
reconfigure=0
ssh_target=""

usage() {
  echo "用法：sudo ./scripts/install-vps.sh [--reconfigure] [--ssh-target user@host]"
}

while (($#)); do
  case "$1" in
    --reconfigure)
      reconfigure=1
      shift
      ;;
    --ssh-target)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      ssh_target="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "此脚本只能在使用 systemd 的 Linux VPS 上运行。" >&2
  exit 1
fi

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  sudo_args=()
  if [[ "$reconfigure" -eq 1 ]]; then
    sudo_args+=(--reconfigure)
  fi
  if [[ -n "$ssh_target" ]]; then
    sudo_args+=(--ssh-target "$ssh_target")
  fi
  exec sudo "$0" "${sudo_args[@]}"
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "未找到 systemd，当前 VPS 暂不支持一键安装。" >&2
  exit 1
fi

install_python() {
  if command -v python3 >/dev/null 2>&1; then
    return
  fi
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-venv python3-pip
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 python3-pip
    return
  fi
  echo "未找到 Python 3，也无法自动安装。请先安装 Python 3.11 或更高版本。" >&2
  exit 1
}

install_python

python_version_ok="$(python3 -c 'import sys; print(int(sys.version_info >= (3, 11)))')"
if [[ "$python_version_ok" != "1" ]]; then
  echo "当前 Python 版本低于 3.11，请升级系统 Python 后重新运行。" >&2
  exit 1
fi

if ! python3 -m venv --help >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv
  else
    echo "缺少 Python venv 模块，请安装后重新运行。" >&2
    exit 1
  fi
fi

if ! getent group "$APP_GROUP" >/dev/null; then
  groupadd --system "$APP_GROUP"
fi
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --gid "$APP_GROUP" --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

install -d -m 0755 "$INSTALL_DIR"
install -d -o root -g "$APP_GROUP" -m 0750 "$CONFIG_DIR"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$DATA_DIR"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  python3 -m venv "$VENV_DIR"
fi
"$VENV_DIR/bin/python" -m pip install --disable-pip-version-check --upgrade pip
"$VENV_DIR/bin/python" -m pip install --disable-pip-version-check --upgrade "$project_dir"

if [[ ! -f "$CONFIG_FILE" || ! -f "$SECRETS_FILE" || "$reconfigure" -eq 1 ]]; then
  configure_args=(
    --config "$CONFIG_FILE"
    --secrets "$SECRETS_FILE"
  )
  if [[ "$reconfigure" -eq 1 ]]; then
    configure_args+=(--force)
  fi
  VPSMON_CONFIG="$CONFIG_FILE" \
  VPSMON_ENV_FILE="$SECRETS_FILE" \
  VPSMON_DATA_FILE="$DATA_FILE" \
    "$VENV_DIR/bin/python" "$project_dir/scripts/configure.py" "${configure_args[@]}"
else
  echo "保留已有供应商配置；如需重新输入凭据，请添加 --reconfigure。"
fi

chown root:"$APP_GROUP" "$CONFIG_FILE" "$SECRETS_FILE"
chmod 0640 "$CONFIG_FILE" "$SECRETS_FILE"

install -o root -g root -m 0644 \
  "$project_dir/deploy/vpsmonitor-provider.service" \
  /etc/systemd/system/vpsmonitor-provider.service
install -o root -g root -m 0644 \
  "$project_dir/deploy/vpsmonitor-api.service" \
  /etc/systemd/system/vpsmonitor-api.service

systemctl daemon-reload

run_as_service_user() {
  runuser -u "$APP_USER" -- env \
    VPSMON_CONFIG="$CONFIG_FILE" \
    VPSMON_ENV_FILE="$SECRETS_FILE" \
    VPSMON_DATA_FILE="$DATA_FILE" \
    "$@"
}

run_as_service_user "$VENV_DIR/bin/vpsmonitor" doctor
if ! run_as_service_user "$VENV_DIR/bin/vpsmonitor" collect; then
  echo "警告：首次供应商采集失败。服务仍会启动并按设定间隔重试；请用 journalctl 查看原因。" >&2
fi

systemctl enable --now vpsmonitor-provider.service vpsmonitor-api.service
systemctl restart vpsmonitor-provider.service vpsmonitor-api.service

api_ready=0
for _ in 1 2 3 4 5; do
  if "$VENV_DIR/bin/python" -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:18787/health", timeout=2)' >/dev/null 2>&1; then
    api_ready=1
    break
  fi
  sleep 1
done
if [[ "$api_ready" -ne 1 ]]; then
  echo "警告：API 健康检查尚未通过，请检查 vpsmonitor-api 日志。" >&2
fi

if [[ -z "$ssh_target" ]]; then
  ssh_user="${SUDO_USER:-root}"
  if [[ "$ssh_user" == "root" || "$ssh_user" == "$APP_USER" ]]; then
    ssh_user="root"
  fi
  server_address=""
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    read -r _ _ server_address _ <<< "$SSH_CONNECTION"
  fi
  if [[ -z "$server_address" ]] && command -v hostname >/dev/null 2>&1; then
    server_address="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  ssh_target="$ssh_user@${server_address:-VPS_IP}"
fi

echo
echo "VPS Monitor 已安装并启动。"
echo "定时采集服务：vpsmonitor-provider.service"
echo "只读 API：127.0.0.1:18787"
echo
echo "在 Mac 应用的“设置 → VPS 连接”中填写："
echo "SSH 地址：$ssh_target"
echo "远端 API 端口：18787"
echo
echo "维护命令："
echo "  systemctl status vpsmonitor-provider vpsmonitor-api"
echo "  journalctl -u vpsmonitor-provider -n 100 --no-pager"
