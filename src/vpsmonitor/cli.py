from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv, set_key

from .config import ConfigError, default_config_path, load_config, secret_env_path
from .db import Database
from .runner import COLLECTORS, collect_once, enabled_provider_names, run_forever


DEFAULT_CONFIG = str(default_config_path())
SECRET_FIELDS = (
    ("VPSMON_BANDWAGON_API_KEY_1", "KiwiVM API Key"),
    ("VPSMON_ALIYUN_ACCESS_KEY_ID", "阿里云 AccessKeyId"),
    ("VPSMON_ALIYUN_ACCESS_KEY_SECRET", "阿里云 AccessKeySecret"),
    ("VPSMON_PANSTAR_TOKEN", "Panstar Token"),
    ("VPSMON_GREENCLOUD_TOKEN", "GreenCloud Token"),
    ("VPSMON_DEDIONE_API_KEY", "DediOne API Key"),
    ("VPSMON_DEDIONE_API_PASS", "DediOne API Pass"),
)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="vpsmonitor")
    root.add_argument("--config", default=DEFAULT_CONFIG, help="YAML 配置文件")
    commands = root.add_subparsers(dest="command", required=True)

    collect = commands.add_parser("collect", help="立即采集一次")
    collect.add_argument("--provider", action="append", choices=sorted(COLLECTORS))

    run = commands.add_parser("run", help="按配置的间隔持续采集")
    run.add_argument("--provider", action="append", choices=sorted(COLLECTORS))

    commands.add_parser("status", help="查看每台实例的最新数据")
    export = commands.add_parser("export-json", help="导出最新数据为 JSON")
    export.add_argument("--output", default="-", help="输出文件，- 表示标准输出")
    commands.add_parser("doctor", help="检查配置和本地数据库")
    commands.add_parser("setup-secrets", help="隐藏输入 API 凭据并写入源码目录外的 secrets.env")
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        config_path = Path(args.config).expanduser().resolve()
        if args.command == "setup-secrets":
            return _setup_secrets(secret_env_path())
        load_dotenv(secret_env_path(), override=False)
        config = load_config(args.config)
        db = Database(config.database_path)
        try:
            if args.command == "collect":
                results = collect_once(config, db, args.provider)
                for result in results:
                    if result.ok:
                        print(f"{result.provider}: OK，写入 {len(result.observations)} 条")
                    else:
                        print(f"{result.provider}: 失败，{result.error}", file=sys.stderr)
                return 0 if all(item.ok for item in results) else 1
            if args.command == "run":
                try:
                    run_forever(config, db, args.provider)
                except KeyboardInterrupt:
                    return 0
            if args.command == "status":
                _print_status(db)
                return 0
            if args.command == "export-json":
                payload = json.dumps(db.latest(), ensure_ascii=False, indent=2)
                if args.output == "-":
                    print(payload)
                else:
                    Path(args.output).write_text(payload + "\n", encoding="utf-8")
                return 0
            if args.command == "doctor":
                print(f"配置：{config.path}")
                print(f"数据库：{config.database_path}")
                print(f"已启用：{', '.join(enabled_provider_names(config)) or '无'}")
                for run in db.recent_runs():
                    state = "OK" if run["ok"] else f"失败：{run['error']}"
                    print(f"最近运行 {run['provider']}: {state} @ {run['finished_at']}")
                return 0
        finally:
            db.close()
    except ConfigError as exc:
        print(f"配置错误：{exc}", file=sys.stderr)
        return 2
    return 0


def _setup_secrets(env_path: Path) -> int:
    print("请从供应商控制台逐项复制凭据。输入内容不会回显。")
    values: dict[str, str] = {}
    try:
        for key, label in SECRET_FIELDS:
            value = getpass.getpass(f"{label}: ").strip()
            if not value:
                print(f"未填写 {label}，没有修改任何文件。", file=sys.stderr)
                return 2
            values[key] = value
    except (EOFError, KeyboardInterrupt):
        print("\n已取消，没有修改任何文件。", file=sys.stderr)
        return 130

    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.touch(mode=0o600, exist_ok=True)
    os.chmod(env_path, 0o600)
    for key, value in values.items():
        set_key(env_path, key, value, quote_mode="always")
    os.chmod(env_path, 0o600)
    print(f"已保存 {len(values)} 项凭据到 {env_path}（权限 0600）。")
    return 0


def _print_status(db: Database) -> None:
    rows = db.latest()
    if not rows:
        print("数据库里还没有采集数据。")
        return
    for row in rows:
        print(f"[{row['provider']}] {row['display_name']} ({row['status'] or 'unknown'})")
        print(f"  实例：{row['instance_key']}  时间：{row['observed_at']}")
        if row["metrics"]:
            print(f"  指标：{json.dumps(row['metrics'], ensure_ascii=False)}")
        if row["quota"]:
            print(f"  配额：{json.dumps(row['quota'], ensure_ascii=False)}")
        if row["metadata"]:
            print(f"  信息：{json.dumps(row['metadata'], ensure_ascii=False)}")


if __name__ == "__main__":
    raise SystemExit(main())
