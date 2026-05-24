from __future__ import annotations

import argparse
import json
import sys

from .client import post_report
from .config import load_config
from .metrics import collect_report
from .timer import DEFAULT_CHECK_INTERVAL_SECONDS, apply_timer_interval, read_timer_interval_seconds, render_timer_unit


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
    systemd_parser.add_argument("--interval-seconds", type=int, default=DEFAULT_CHECK_INTERVAL_SECONDS)

    args = parser.parse_args()

    if args.command == "once":
        config = load_config(args.config)
        report = collect_report(config)
        report["applied_check_interval_seconds"] = read_timer_interval_seconds()
        if args.dry_run:
            print(json.dumps(report, indent=2, sort_keys=True))
            return
        result = post_report(config, report)
        target_interval = result.get("check_interval_seconds")
        if isinstance(target_interval, int):
            result["timer_sync"] = apply_timer_interval(target_interval)
        print(json.dumps(result, indent=2, sort_keys=True))
        return

    if args.command == "print-systemd":
        print(_systemd_unit(args.config, args.binary, args.user, args.interval_seconds))
        return

    sys.exit(2)


def _systemd_unit(config_path: str, binary: str, user: str, interval_seconds: int) -> str:
    return f"""# /etc/systemd/system/vpsmon-agent.service
[Unit]
Description=VPSMonitor agent report
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User={user}
ExecStart={binary} once --config {config_path}

{render_timer_unit(interval_seconds)}"""
