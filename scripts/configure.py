#!/usr/bin/env python3
from __future__ import annotations

import argparse
import getpass
import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import set_key

from vpsmonitor.config import default_config_path, default_data_path, secret_env_path


def _yes_no(prompt: str, *, default: bool = False) -> bool:
    suffix = "[Y/n]" if default else "[y/N]"
    answer = input(f"{prompt} {suffix}: ").strip().casefold()
    if not answer:
        return default
    return answer in {"y", "yes", "是"}


def _text(prompt: str, *, default: str | None = None, required: bool = False) -> str:
    suffix = f" [{default}]" if default else ""
    while True:
        value = input(f"{prompt}{suffix}: ").strip()
        if value:
            return value
        if default is not None:
            return default
        if not required:
            return ""
        print("此项不能为空。")


def _secret(prompt: str) -> str:
    while True:
        value = getpass.getpass(f"{prompt}（输入不回显）: ").strip()
        if value:
            return value
        print("凭据不能为空。")


def _integer(prompt: str, *, default: int, minimum: int) -> int:
    while True:
        value = _text(prompt, default=str(default))
        try:
            parsed = int(value)
        except ValueError:
            print("请输入整数。")
            continue
        if parsed < minimum:
            print(f"不能小于 {minimum}。")
            continue
        return parsed


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _write_yaml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(path.suffix + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        yaml.safe_dump(data, stream, allow_unicode=True, sort_keys=False)
    os.replace(temporary, path)
    os.chmod(path, 0o600)


def _write_secrets(path: Path, values: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.close(descriptor)
    for key, value in values.items():
        set_key(path, key, value, quote_mode="always")
    os.chmod(path, 0o600)


def _configure(template_path: Path) -> tuple[dict[str, Any], dict[str, str], list[str]]:
    config = yaml.safe_load(template_path.read_text(encoding="utf-8")) or {}
    if not isinstance(config, dict) or not isinstance(config.get("providers"), dict):
        raise RuntimeError("配置模板格式无效")

    config.setdefault("storage", {})["database"] = str(default_data_path())
    poll = config.setdefault("poll", {})
    poll["interval_seconds"] = _integer(
        "定时检测间隔（秒）",
        default=int(poll.get("interval_seconds", 300)),
        minimum=30,
    )
    providers: dict[str, Any] = config["providers"]
    secrets: dict[str, str] = {
        "VPSMON_API_HOST": "127.0.0.1",
        "VPSMON_API_PORT": "18787",
        "VPSMON_LIVE_MIN_INTERVAL_SECONDS": "30",
    }
    enabled: list[str] = []

    if _yes_no("启用 RackNerd / SolusVM"):
        provider = providers["racknerd"]
        provider["enabled"] = True
        provider["instances"] = [
            {
                "name": _text("节点显示名称", default="RackNerd 示例节点"),
                "instance_id": _text("本地实例标识", default="racknerd-1"),
                "api_key": {"env": "VPSMON_RACKNERD_API_KEY_1"},
                "api_hash": {"env": "VPSMON_RACKNERD_API_HASH_1"},
            }
        ]
        secrets["VPSMON_RACKNERD_API_KEY_1"] = _secret("RackNerd API Key")
        secrets["VPSMON_RACKNERD_API_HASH_1"] = _secret("RackNerd API Hash")
        enabled.append("racknerd")

    if _yes_no("启用 BandwagonHost / KiwiVM"):
        provider = providers["bandwagon"]
        provider["enabled"] = True
        provider["instances"] = [
            {
                "name": _text("节点显示名称", default="Bandwagon 示例节点"),
                "veid": _text("VEID", required=True),
                "api_key": {"env": "VPSMON_BANDWAGON_API_KEY_1"},
            }
        ]
        secrets["VPSMON_BANDWAGON_API_KEY_1"] = _secret("KiwiVM API Key")
        enabled.append("bandwagon")

    if _yes_no("启用阿里云轻量应用服务器 SWAS"):
        provider = providers["aliyun_swas"]
        provider["enabled"] = True
        provider["region_id"] = _text("地域 ID", default="cn-hangzhou")
        provider["instance_ids"] = _csv(_text("实例 ID（逗号分隔，留空自动发现）"))
        secrets["VPSMON_ALIYUN_ACCESS_KEY_ID"] = _secret("阿里云 AccessKeyId")
        secrets["VPSMON_ALIYUN_ACCESS_KEY_SECRET"] = _secret("阿里云 AccessKeySecret")
        enabled.append("aliyun_swas")

    if _yes_no("启用 PanstarCloud"):
        provider = providers["panstar"]
        provider["enabled"] = True
        provider["base_url"] = _text("Panstar API 地址", default="https://panstar.ai")
        secrets["VPSMON_PANSTAR_TOKEN"] = _secret("Panstar 只读 Token")
        enabled.append("panstar")

    if _yes_no("启用 GreenCloud / VirtFusion"):
        provider = providers["greencloud"]
        provider["enabled"] = True
        provider["base_url"] = _text("GreenCloud API 地址", default="https://cp.green.cloud")
        secrets["VPSMON_GREENCLOUD_TOKEN"] = _secret("GreenCloud 只读 Token")
        enabled.append("greencloud")

    if _yes_no("启用 DediOne / Virtualizor"):
        provider = providers["dedione"]
        provider["enabled"] = True
        provider["base_url"] = _text(
            "Virtualizor API 地址",
            default="https://manage.example.invalid:4083",
        )
        provider["vps_ids"] = _csv(_text("VPS ID（逗号分隔，留空自动发现）"))
        secrets["VPSMON_DEDIONE_API_KEY"] = _secret("Virtualizor API Key")
        secrets["VPSMON_DEDIONE_API_PASS"] = _secret("Virtualizor API Pass")
        enabled.append("dedione")

    return config, secrets, enabled


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="安全生成 VPS Monitor 本地配置")
    parser.add_argument("--config", type=Path, default=default_config_path())
    parser.add_argument("--secrets", type=Path, default=secret_env_path())
    parser.add_argument("--force", action="store_true", help="覆盖已有配置")
    args = parser.parse_args()

    config_path = args.config.expanduser().resolve()
    secrets_path = args.secrets.expanduser().resolve()
    existing = [path for path in (config_path, secrets_path) if path.exists()]
    if existing and not args.force:
        names = "、".join(str(path) for path in existing)
        if not _yes_no(f"以下配置已存在：{names}。确认覆盖", default=False):
            print("已取消，未修改配置。")
            return 1

    try:
        config, secrets, enabled = _configure(root / "config" / "providers.example.yaml")
    except (EOFError, KeyboardInterrupt):
        print("\n已取消，未写入任何配置。")
        return 130

    _write_yaml(config_path, config)
    _write_secrets(secrets_path, secrets)
    print(f"配置已写入：{config_path}")
    print(f"凭据已写入：{secrets_path}（权限 0600）")
    print(f"已启用供应商：{', '.join(enabled) if enabled else '无'}")
    print("下一步：uv run vpsmonitor doctor")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
