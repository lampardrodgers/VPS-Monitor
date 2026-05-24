from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class AgentConfig:
    controller_url: str
    node_id: str
    node_token: str
    interface: str = "auto"
    disk_path: str = "/"
    timeout_seconds: int = 15


def load_config(path: str | Path) -> AgentConfig:
    config_path = Path(path).expanduser().resolve()
    raw: dict[str, Any] = yaml.safe_load(config_path.read_text()) or {}
    return AgentConfig(
        controller_url=str(raw["controller_url"]).rstrip("/"),
        node_id=str(raw["node_id"]),
        node_token=str(raw["node_token"]),
        interface=str(raw.get("interface", "auto")),
        disk_path=str(raw.get("disk_path", "/")),
        timeout_seconds=int(raw.get("timeout_seconds", 15)),
    )
