from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


APP_DIRECTORY = "vpsmonitor"


class ConfigError(RuntimeError):
    pass


@dataclass(slots=True)
class AppConfig:
    path: Path
    database_path: Path
    history_retention_days: int
    run_retention_days: int
    poll_interval_seconds: int
    timeout_seconds: float
    providers: dict[str, Any]


def config_home() -> Path:
    override = os.getenv("VPSMON_CONFIG_HOME")
    if override:
        return Path(override).expanduser().resolve()
    xdg_home = os.getenv("XDG_CONFIG_HOME")
    base = Path(xdg_home).expanduser() if xdg_home else Path.home() / ".config"
    return (base / APP_DIRECTORY).resolve()


def default_config_path() -> Path:
    override = os.getenv("VPSMON_CONFIG")
    return Path(override).expanduser().resolve() if override else config_home() / "providers.yaml"


def secret_env_path() -> Path:
    override = os.getenv("VPSMON_ENV_FILE")
    return Path(override).expanduser().resolve() if override else config_home() / "secrets.env"


def default_data_path() -> Path:
    override = os.getenv("VPSMON_DATA_FILE")
    if override:
        return Path(override).expanduser().resolve()
    xdg_home = os.getenv("XDG_DATA_HOME")
    base = Path(xdg_home).expanduser() if xdg_home else Path.home() / ".local" / "share"
    return (base / APP_DIRECTORY / "vpsmonitor.sqlite3").resolve()


def resolve_secret(value: Any, *, field: str) -> str:
    if isinstance(value, dict) and set(value) == {"env"}:
        env_name = str(value["env"])
        secret = os.getenv(env_name)
        if not secret:
            raise ConfigError(f"环境变量 {env_name} 未设置（{field}）")
        return secret
    if isinstance(value, str) and value.startswith("env:"):
        env_name = value[4:]
        secret = os.getenv(env_name)
        if not secret:
            raise ConfigError(f"环境变量 {env_name} 未设置（{field}）")
        return secret
    if isinstance(value, str) and value:
        raise ConfigError(f"{field} 禁止使用明文；请改为 env 引用")
    raise ConfigError(f"缺少凭据引用：{field}")


def load_config(path: str | Path) -> AppConfig:
    config_path = Path(path).expanduser().resolve()
    if not config_path.exists():
        raise ConfigError(f"配置文件不存在：{config_path}")
    try:
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"YAML 配置错误：{exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError("配置文件顶层必须是对象")

    storage = raw.get("storage") or {}
    poll = raw.get("poll") or {}
    database_value = storage.get("database") or str(default_data_path())
    database_path = Path(database_value).expanduser()
    if not database_path.is_absolute():
        database_path = (config_path.parent.parent / database_path).resolve()

    providers = raw.get("providers") or {}
    if not isinstance(providers, dict):
        raise ConfigError("providers 必须是对象")
    return AppConfig(
        path=config_path,
        database_path=database_path,
        history_retention_days=max(1, int(storage.get("history_retention_days", 7))),
        run_retention_days=max(1, int(storage.get("run_retention_days", 30))),
        poll_interval_seconds=max(30, int(poll.get("interval_seconds", 60))),
        timeout_seconds=max(1.0, float(poll.get("timeout_seconds", 20))),
        providers=providers,
    )
