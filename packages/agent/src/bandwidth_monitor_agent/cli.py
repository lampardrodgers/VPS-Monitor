from __future__ import annotations

import argparse
import json
import sys

from .client import post_report
from .config import load_config
from .metrics import collect_report


def main() -> None:
    parser = argparse.ArgumentParser(prog="vpsmon-agent")
    subparsers = parser.add_subparsers(dest="command", required=True)

    once_parser = subparsers.add_parser("once")
    once_parser.add_argument("--config", required=True)
    once_parser.add_argument("--dry-run", action="store_true")

    systemd_parser = subparsers.add_parser("print-systemd")
    systemd_parser.add_argument("--config", default="/etc/vpsmonitor/agent.yaml")
    systemd_parser.add_argument("--binary", default="/usr/local/bin/vpsmon-agent")
    systemd_parser.add_argument("--user", default="root")

    args = parser.parse_args()

    if args.command == "once":
        config = load_config(args.config)
        report = collect_report(config)
        if args.dry_run:
            print(json.dumps(report, indent=2, sort_keys=True))
            return
        result = post_report(config, report)
        print(json.dumps(result, indent=2, sort_keys=True))
        return

    if args.command == "print-systemd":
        print(_systemd_unit(args.config, args.binary, args.user))
        return

    sys.exit(2)


def _systemd_unit(config_path: str, binary: str, user: str) -> str:
    return f"""# /etc/systemd/system/vpsmon-agent.service
[Unit]
Description=VPSMonitor agent report
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User={user}
ExecStart={binary} once --config {config_path}

# /etc/systemd/system/vpsmon-agent.timer
[Unit]
Description=Run VPSMonitor agent every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target

# Enable with:
# sudo systemctl daemon-reload
# sudo systemctl enable --now vpsmon-agent.timer
"""
