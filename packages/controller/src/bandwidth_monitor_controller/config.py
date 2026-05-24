from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import os

import yaml


@dataclass(frozen=True)
class AlertConfig:
    stale_after_minutes: int = 45
    disk_warning_percent: float = 15.0
    traffic_warning_percent: float = 25.0
    traffic_critical_percent: float = 10.0
    forecast_days: int = 7
    forecast_window_days: int = 3


@dataclass(frozen=True)
class TelegramConfig:
    enabled: bool = False
    bot_token_env: str = "TELEGRAM_BOT_TOKEN"
    chat_id_env: str = "TELEGRAM_CHAT_ID"


@dataclass(frozen=True)
class BarkConfig:
    enabled: bool = False
    url_env: str = "BARK_URL"


@dataclass(frozen=True)
class NotificationConfig:
    telegram: TelegramConfig = TelegramConfig()
    bark: BarkConfig = BarkConfig()


@dataclass(frozen=True)
class ControllerConfig:
    database: Path
    alerts: AlertConfig = AlertConfig()
    notifications: NotificationConfig = NotificationConfig()


def _expand_path(value: str, base_dir: Path) -> Path:
    expanded = Path(os.path.expandvars(os.path.expanduser(value)))
    if expanded.is_absolute():
        return expanded
    return base_dir / expanded


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def load_config(path: str | Path) -> ControllerConfig:
    config_path = Path(path).expanduser().resolve()
    raw = yaml.safe_load(config_path.read_text()) if config_path.exists() else {}
    raw = _dict(raw)
    base_dir = config_path.parent

    alerts_raw = _dict(raw.get("alerts"))
    notify_raw = _dict(raw.get("notifications"))
    telegram_raw = _dict(notify_raw.get("telegram"))
    bark_raw = _dict(notify_raw.get("bark"))

    return ControllerConfig(
        database=_expand_path(str(raw.get("database", "controller.sqlite3")), base_dir),
        alerts=AlertConfig(
            stale_after_minutes=int(alerts_raw.get("stale_after_minutes", 45)),
            disk_warning_percent=float(alerts_raw.get("disk_warning_percent", 15)),
            traffic_warning_percent=float(alerts_raw.get("traffic_warning_percent", 25)),
            traffic_critical_percent=float(alerts_raw.get("traffic_critical_percent", 10)),
            forecast_days=int(alerts_raw.get("forecast_days", 7)),
            forecast_window_days=int(alerts_raw.get("forecast_window_days", 3)),
        ),
        notifications=NotificationConfig(
            telegram=TelegramConfig(
                enabled=bool(telegram_raw.get("enabled", False)),
                bot_token_env=str(telegram_raw.get("bot_token_env", "TELEGRAM_BOT_TOKEN")),
                chat_id_env=str(telegram_raw.get("chat_id_env", "TELEGRAM_CHAT_ID")),
            ),
            bark=BarkConfig(
                enabled=bool(bark_raw.get("enabled", False)),
                url_env=str(bark_raw.get("url_env", "BARK_URL")),
            ),
        ),
    )
