from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from .config import AlertConfig
from .db import parse_dt, recent_reports


def bytes_for_mode(rx: int | None, tx: int | None, mode: str) -> int | None:
    if rx is None and tx is None:
        return None
    rx_value = int(rx or 0)
    tx_value = int(tx or 0)
    if mode == "inbound":
        return rx_value
    if mode == "outbound":
        return tx_value
    return rx_value + tx_value


def percent(numerator: int | float | None, denominator: int | float | None) -> float | None:
    if numerator is None or not denominator:
        return None
    return round(float(numerator) / float(denominator) * 100, 2)


def build_node_view(conn, row: dict[str, Any], alerts: AlertConfig) -> dict[str, Any]:
    quota_bytes = row.get("quota_bytes")
    used_bytes = bytes_for_mode(
        row.get("period_rx_bytes"),
        row.get("period_tx_bytes"),
        row.get("counting_mode", "total"),
    )
    remaining_bytes = quota_bytes - used_bytes if quota_bytes is not None and used_bytes is not None else None
    traffic_used_percent = percent(used_bytes, quota_bytes)
    traffic_remaining_percent = (
        round(100.0 - traffic_used_percent, 2) if traffic_used_percent is not None else None
    )
    memory_used_percent = percent(row.get("memory_used_bytes"), row.get("memory_total_bytes"))
    disk_used_percent = percent(row.get("disk_used_bytes"), row.get("disk_total_bytes"))
    collected_at = parse_dt(row.get("collected_at"))
    stale = True
    if collected_at:
        stale = datetime.now(UTC) - collected_at > timedelta(minutes=alerts.stale_after_minutes)

    forecast = forecast_exhaustion(conn, row["id"], quota_bytes, row.get("counting_mode", "total"), alerts)
    status = status_for_node(
        stale=stale,
        disk_used_percent=disk_used_percent,
        traffic_remaining_percent=traffic_remaining_percent,
        alerts=alerts,
    )

    return {
        "id": row["id"],
        "name": row["name"],
        "provider": row.get("provider") or "",
        "country": row.get("country") or "",
        "quota_bytes": quota_bytes,
        "cycle_day": row.get("cycle_day", 1),
        "counting_mode": row.get("counting_mode", "total"),
        "last_reported_at": row.get("collected_at"),
        "status": status,
        "stale": stale,
        "cpu_percent": row.get("cpu_percent"),
        "memory_total_bytes": row.get("memory_total_bytes"),
        "memory_used_bytes": row.get("memory_used_bytes"),
        "memory_used_percent": memory_used_percent,
        "disk_total_bytes": row.get("disk_total_bytes"),
        "disk_used_bytes": row.get("disk_used_bytes"),
        "disk_used_percent": disk_used_percent,
        "rx_bytes": row.get("rx_bytes"),
        "tx_bytes": row.get("tx_bytes"),
        "period_started_at": row.get("period_started_at"),
        "period_used_bytes": used_bytes,
        "traffic_remaining_bytes": max(remaining_bytes, 0) if remaining_bytes is not None else None,
        "traffic_used_percent": traffic_used_percent,
        "traffic_remaining_percent": traffic_remaining_percent,
        "forecast_exhaustion_at": forecast["forecast_exhaustion_at"],
        "average_daily_bytes": forecast["average_daily_bytes"],
    }


def status_for_node(
    *,
    stale: bool,
    disk_used_percent: float | None,
    traffic_remaining_percent: float | None,
    alerts: AlertConfig,
) -> str:
    if stale:
        return "offline"
    if traffic_remaining_percent is not None and traffic_remaining_percent <= alerts.traffic_critical_percent:
        return "critical"
    if traffic_remaining_percent is not None and traffic_remaining_percent <= alerts.traffic_warning_percent:
        return "warning"
    if disk_used_percent is not None and 100.0 - disk_used_percent <= alerts.disk_warning_percent:
        return "warning"
    return "ok"


def forecast_exhaustion(conn, node_id: str, quota_bytes: int | None, counting_mode: str, alerts: AlertConfig) -> dict[str, Any]:
    if not quota_bytes:
        return {"forecast_exhaustion_at": None, "average_daily_bytes": None}
    reports = recent_reports(conn, node_id, alerts.forecast_window_days)
    points = []
    for report in reports:
        used = bytes_for_mode(report.get("period_rx_bytes"), report.get("period_tx_bytes"), counting_mode)
        collected = parse_dt(report.get("collected_at"))
        if used is not None and collected is not None:
            points.append((collected, used))
    if len(points) < 2:
        return {"forecast_exhaustion_at": None, "average_daily_bytes": None}
    start_time, start_used = points[0]
    end_time, end_used = points[-1]
    elapsed_days = max((end_time - start_time).total_seconds() / 86400.0, 0.001)
    average_daily = max((end_used - start_used) / elapsed_days, 0)
    if average_daily <= 0:
        return {"forecast_exhaustion_at": None, "average_daily_bytes": 0}
    remaining = max(quota_bytes - end_used, 0)
    exhaustion = end_time + timedelta(days=remaining / average_daily)
    return {
        "forecast_exhaustion_at": exhaustion.isoformat(),
        "average_daily_bytes": int(average_daily),
    }
