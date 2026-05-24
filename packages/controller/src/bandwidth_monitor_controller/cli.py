from __future__ import annotations

from shutil import which
from urllib.parse import urlencode
import argparse
import json
import shlex
import subprocess

import uvicorn

from . import db
from .app import create_app
from .config import load_config
from .notifications import send_notification
from .service import evaluate_all_nodes


def main() -> None:
    parser = argparse.ArgumentParser(prog="vpsmon-controller")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init-db")
    init_parser.add_argument("--config", required=True)

    serve_parser = subparsers.add_parser("serve")
    serve_parser.add_argument("--config", required=True)
    serve_parser.add_argument("--host", default="0.0.0.0")
    serve_parser.add_argument("--port", type=int, default=8080)

    node_parser = subparsers.add_parser("create-node")
    node_parser.add_argument("--config", required=True)
    node_parser.add_argument("--name", required=True)
    node_parser.add_argument("--id")
    node_parser.add_argument("--provider", default="")
    node_parser.add_argument("--country", default="")
    node_parser.add_argument("--quota-gb", type=float)
    node_parser.add_argument("--cycle-day", type=int, default=1)
    node_parser.add_argument("--counting-mode", choices=["total", "inbound", "outbound"], default="total")
    node_parser.add_argument("--controller-url")
    node_parser.add_argument(
        "--agent-install-script-url",
        default="https://raw.githubusercontent.com/yourname/VPSMonitor/main/scripts/install-agent.sh",
    )
    node_parser.add_argument("--qr", action="store_true")

    delete_parser = subparsers.add_parser("delete-node")
    delete_parser.add_argument("--config", required=True)
    delete_parser.add_argument("--id", required=True)

    update_parser = subparsers.add_parser("update-node")
    update_parser.add_argument("--config", required=True)
    update_parser.add_argument("--id", required=True)
    update_parser.add_argument("--name")
    update_parser.add_argument("--provider")
    update_parser.add_argument("--country")
    update_parser.add_argument("--quota-gb", type=float)
    update_parser.add_argument("--clear-quota", action="store_true")

    list_parser = subparsers.add_parser("list-nodes")
    list_parser.add_argument("--config", required=True)
    list_parser.add_argument("--json", action="store_true")

    app_parser = subparsers.add_parser("create-app-token")
    app_parser.add_argument("--config", required=True)
    app_parser.add_argument("--name", default="iOS App")
    app_parser.add_argument("--base-url", required=True)
    app_parser.add_argument("--qr", action="store_true")

    join_parser = subparsers.add_parser("show-join")
    join_parser.add_argument("--config", required=True)
    join_parser.add_argument("--base-url", required=True)
    join_parser.add_argument(
        "--agent-install-script-url",
        default="https://raw.githubusercontent.com/yourname/VPSMonitor/main/scripts/install-agent.sh",
    )

    check_parser = subparsers.add_parser("check-alerts")
    check_parser.add_argument("--config", required=True)

    systemd_parser = subparsers.add_parser("print-systemd")
    systemd_parser.add_argument("--config", default="/etc/vpsmonitor/controller.yaml")
    systemd_parser.add_argument("--binary", default="/usr/local/bin/vpsmon-controller")
    systemd_parser.add_argument("--user", default="vpsmonitor")
    systemd_parser.add_argument("--host", default="127.0.0.1")
    systemd_parser.add_argument("--port", type=int, default=8080)

    args = parser.parse_args()

    if args.command == "print-systemd":
        print(_systemd_units(args.config, args.binary, args.user, args.host, args.port))
        return

    if args.command == "serve":
        uvicorn.run(create_app(args.config), host=args.host, port=args.port)
        return

    config = load_config(args.config)
    with db.connect(config.database) as conn:
        db.init_db(conn)
        if args.command == "init-db":
            print(json.dumps({"database": str(config.database), "status": "ready"}, indent=2))
        elif args.command == "create-node":
            node_id, token = db.create_node(
                conn,
                node_id=args.id,
                name=args.name,
                provider=args.provider,
                country=args.country,
                quota_gb=args.quota_gb,
                cycle_day=args.cycle_day,
                counting_mode=args.counting_mode,
            )
            agent_pairing_url = None
            agent_install_command = None
            if args.controller_url:
                agent_pairing_url = _agent_pairing_url(args.controller_url, node_id, token)
                agent_install_command = _agent_install_command(args.agent_install_script_url, args.controller_url, node_id, token)
            print(
                json.dumps(
                    {
                        "node_id": node_id,
                        "node_token": token,
                        "agent_config": {
                            "controller_url": "https://your-controller.example.com",
                            "node_id": node_id,
                            "node_token": token,
                            "interface": "auto",
                            "disk_path": "/",
                        },
                        "agent_pairing_url": agent_pairing_url,
                        "agent_install_command": agent_install_command,
                    },
                    indent=2,
                )
            )
            if args.qr and agent_pairing_url:
                _print_qr(agent_pairing_url)
        elif args.command == "delete-node":
            deleted = db.delete_node(conn, args.id)
            print(json.dumps({"node_id": args.id, "deleted": deleted}, indent=2))
        elif args.command == "update-node":
            if args.quota_gb is not None and args.clear_quota:
                raise SystemExit("--quota-gb and --clear-quota cannot be used together")
            quota_gb = None if args.clear_quota else args.quota_gb
            if args.quota_gb is None and not args.clear_quota:
                quota_gb = db._UNSET
            updated = db.update_node_metadata(
                conn,
                args.id,
                name=args.name,
                provider=args.provider,
                country=args.country,
                quota_gb=quota_gb,
            )
            if not updated:
                raise SystemExit(f"Node not found: {args.id}")
            node = db.node_by_id(conn, args.id)
            print(json.dumps(node, indent=2))
        elif args.command == "list-nodes":
            nodes = db.nodes_with_latest(conn)
            if args.json:
                print(json.dumps(nodes, indent=2))
            else:
                _print_nodes(nodes)
        elif args.command == "create-app-token":
            token_id, token = db.create_app_token(conn, name=args.name)
            pairing_url = "vpsmonitor://pair?" + urlencode({"base_url": args.base_url.rstrip("/"), "token": token})
            print(
                json.dumps(
                    {
                        "token_id": token_id,
                        "app_token": token,
                        "pairing_url": pairing_url,
                    },
                    indent=2,
                )
            )
            if args.qr:
                _print_qr(pairing_url)
        elif args.command == "show-join":
            _print_join_help(args.base_url, args.agent_install_script_url)
        elif args.command == "check-alerts":
            created = []
            for alert in evaluate_all_nodes(conn, config.alerts):
                if alert["created"]:
                    send_notification(config.notifications, alert["title"], alert["message"])
                    created.append(alert)
            print(json.dumps({"created_alerts": len(created)}, indent=2))


def _systemd_units(config_path: str, binary: str, user: str, host: str, port: int) -> str:
    return f"""# /etc/systemd/system/vpsmon-controller.service
[Unit]
Description=VPSMonitor controller API
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User={user}
EnvironmentFile=-/etc/vpsmonitor/controller.env
ExecStart={binary} serve --config {config_path} --host {host} --port {port}
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target

# /etc/systemd/system/vpsmon-controller-alerts.service
[Unit]
Description=VPSMonitor scheduled alert evaluation
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User={user}
EnvironmentFile=-/etc/vpsmonitor/controller.env
ExecStart={binary} check-alerts --config {config_path}

# /etc/systemd/system/vpsmon-controller-alerts.timer
[Unit]
Description=Run VPSMonitor alert evaluation every 15 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=15min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target

# Enable with:
# sudo systemctl daemon-reload
# sudo systemctl enable --now vpsmon-controller.service
# sudo systemctl enable --now vpsmon-controller-alerts.timer
"""


def _agent_pairing_url(controller_url: str, node_id: str, node_token: str) -> str:
    return "vpsmon-agent://join?" + urlencode(
        {
            "controller_url": controller_url.rstrip("/"),
            "node_id": node_id,
            "node_token": node_token,
        }
    )


def _agent_install_command(script_url: str, controller_url: str, node_id: str, node_token: str) -> str:
    return (
        f"curl -fsSL {shlex.quote(script_url)} | "
        f"sudo env VPSMON_CONTROLLER_URL={shlex.quote(controller_url.rstrip('/'))} "
        f"VPSMON_NODE_ID={shlex.quote(node_id)} "
        f"VPSMON_NODE_TOKEN={shlex.quote(node_token)} bash"
    )


def _print_qr(value: str) -> None:
    if which("qrencode"):
        subprocess.run(["qrencode", "-t", "ANSIUTF8", value], check=False)
    else:
        print("qrencode is not installed; QR output skipped.")
    print(value)


def _print_nodes(nodes: list[dict]) -> None:
    if not nodes:
        print("No nodes registered.")
        return
    print(f"{'ID':<24} {'NAME':<24} {'PROVIDER':<16} {'COUNTRY':<8} {'LAST REPORT':<28}")
    for node in nodes:
        print(
            f"{node['id']:<24} "
            f"{node['name']:<24} "
            f"{(node.get('provider') or '-'):<16} "
            f"{(node.get('country') or '-'):<8} "
            f"{(node.get('collected_at') or '-'):<28}"
        )


def _print_join_help(base_url: str, script_url: str) -> None:
    base_url = base_url.rstrip("/")
    print("Create a child VPS token and install command with:")
    print()
    print(
        "vpsmon-controller create-node "
        "--config /etc/vpsmonitor/controller.yaml "
        "--name <node-name> "
        "--id <node-id> "
        "--quota-gb <monthly-quota-gb> "
        f"--controller-url {base_url} "
        f"--agent-install-script-url {script_url} "
        "--qr"
    )
    print()
    print("List registered nodes with:")
    print("vpsmon-controller list-nodes --config /etc/vpsmonitor/controller.yaml")
    print()
    print("Revoke a node token and delete its reports with:")
    print("vpsmon-controller delete-node --config /etc/vpsmonitor/controller.yaml --id <node-id>")
