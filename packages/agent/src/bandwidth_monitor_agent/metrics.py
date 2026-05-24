from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
import json
import shutil
import subprocess
import time

from .config import AgentConfig


def collect_report(config: AgentConfig) -> dict[str, Any]:
    interface = config.interface if config.interface != "auto" else default_interface()
    rx_bytes, tx_bytes = read_interface_bytes(interface)
    period = read_vnstat_month(interface)
    disk = shutil.disk_usage(config.disk_path)
    memory_total, memory_used = read_memory()
    return {
        "node_id": config.node_id,
        "collected_at": datetime.now(UTC).isoformat(),
        "cpu_percent": read_cpu_percent(),
        "memory_total_bytes": memory_total,
        "memory_used_bytes": memory_used,
        "disk_total_bytes": disk.total,
        "disk_used_bytes": disk.used,
        "rx_bytes": rx_bytes,
        "tx_bytes": tx_bytes,
        "period_rx_bytes": period.get("period_rx_bytes"),
        "period_tx_bytes": period.get("period_tx_bytes"),
        "period_started_at": period.get("period_started_at"),
        "raw": {
            "interface": interface,
            "disk_path": config.disk_path,
            "traffic_source": period.get("source", "proc_net_dev"),
            "vnstat_available": period.get("source") == "vnstat",
        },
    }


def read_cpu_percent(sample_seconds: float = 0.2) -> float | None:
    first = _read_cpu_ticks()
    time.sleep(sample_seconds)
    second = _read_cpu_ticks()
    if not first or not second:
        return None
    idle_delta = second["idle"] - first["idle"]
    total_delta = second["total"] - first["total"]
    if total_delta <= 0:
        return None
    return round((1.0 - idle_delta / total_delta) * 100.0, 2)


def _read_cpu_ticks() -> dict[str, int] | None:
    try:
        fields = Path("/proc/stat").read_text().splitlines()[0].split()
    except OSError:
        return None
    if not fields or fields[0] != "cpu":
        return None
    values = [int(value) for value in fields[1:]]
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return {"idle": idle, "total": sum(values)}


def read_memory() -> tuple[int | None, int | None]:
    try:
        lines = Path("/proc/meminfo").read_text().splitlines()
    except OSError:
        return None, None
    values: dict[str, int] = {}
    for line in lines:
        key, _, rest = line.partition(":")
        amount = rest.strip().split()[0]
        if amount.isdigit():
            values[key] = int(amount) * 1024
    total = values.get("MemTotal")
    available = values.get("MemAvailable")
    if total is None or available is None:
        return total, None
    return total, max(total - available, 0)


def default_interface() -> str:
    try:
        completed = subprocess.run(
            ["ip", "route", "show", "default"],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
        for token_index, token in enumerate(completed.stdout.split()):
            if token == "dev":
                return completed.stdout.split()[token_index + 1]
    except (OSError, subprocess.SubprocessError, IndexError):
        pass
    counters = read_all_interface_bytes()
    for name in counters:
        if name != "lo":
            return name
    return "lo"


def read_interface_bytes(interface: str) -> tuple[int | None, int | None]:
    counters = read_all_interface_bytes()
    return counters.get(interface, (None, None))


def read_all_interface_bytes() -> dict[str, tuple[int, int]]:
    try:
        lines = Path("/proc/net/dev").read_text().splitlines()[2:]
    except OSError:
        return {}
    counters: dict[str, tuple[int, int]] = {}
    for line in lines:
        name, _, rest = line.partition(":")
        fields = rest.split()
        if len(fields) < 16:
            continue
        counters[name.strip()] = (int(fields[0]), int(fields[8]))
    return counters


def read_vnstat_month(interface: str) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            ["vnstat", "--json", "m", "1", "-i", interface],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return {"source": "proc_net_dev"}
    if completed.returncode != 0 or not completed.stdout.strip():
        return {"source": "proc_net_dev"}
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return {"source": "proc_net_dev"}
    entry = _latest_vnstat_month(payload, interface)
    if not entry:
        return {"source": "proc_net_dev"}
    date = entry.get("date") or {}
    year = int(date.get("year", datetime.now(UTC).year))
    month = int(date.get("month", datetime.now(UTC).month))
    return {
        "source": "vnstat",
        "period_rx_bytes": _traffic_value(entry.get("rx")),
        "period_tx_bytes": _traffic_value(entry.get("tx")),
        "period_started_at": datetime(year, month, 1, tzinfo=UTC).isoformat(),
    }


def _latest_vnstat_month(payload: dict[str, Any], interface: str) -> dict[str, Any] | None:
    for item in payload.get("interfaces", []):
        if item.get("name") != interface:
            continue
        traffic = item.get("traffic", {})
        months = traffic.get("month") or traffic.get("months") or []
        return months[-1] if months else None
    interfaces = payload.get("interfaces", [])
    if interfaces:
        traffic = interfaces[0].get("traffic", {})
        months = traffic.get("month") or traffic.get("months") or []
        return months[-1] if months else None
    return None


def _traffic_value(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, dict):
        for key in ("bytes", "value"):
            if key in value:
                return _traffic_value(value[key])
    return None
