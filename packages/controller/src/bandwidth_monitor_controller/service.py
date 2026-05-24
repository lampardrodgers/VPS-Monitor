from __future__ import annotations

from datetime import UTC, datetime, timedelta
from sqlite3 import Connection
from typing import Any

from . import db
from .analytics import build_node_view
from .config import AlertConfig


def evaluate_alerts_for_node(conn: Connection, node_id: str, config: AlertConfig) -> list[dict[str, Any]]:
    row = db.node_by_id(conn, node_id)
    if not row:
        return []
    node = build_node_view(conn, row, config)
    candidates: list[dict[str, str]] = []

    if node["stale"]:
        candidates.append(
            _candidate(
                node,
                kind="offline",
                level="critical",
                dedupe_key="offline",
                message=f"{node['name']} has not reported within {config.stale_after_minutes} minutes.",
            )
        )

    remaining_percent = node.get("traffic_remaining_percent")
    if remaining_percent is not None:
        if remaining_percent <= config.traffic_critical_percent:
            candidates.append(
                _candidate(
                    node,
                    kind="traffic",
                    level="critical",
                    dedupe_key=_traffic_dedupe(node, "critical"),
                    message=f"{node['name']} traffic remaining is {remaining_percent:.1f}%.",
                )
            )
        elif remaining_percent <= config.traffic_warning_percent:
            candidates.append(
                _candidate(
                    node,
                    kind="traffic",
                    level="warning",
                    dedupe_key=_traffic_dedupe(node, "warning"),
                    message=f"{node['name']} traffic remaining is {remaining_percent:.1f}%.",
                )
            )

    disk_used_percent = node.get("disk_used_percent")
    if disk_used_percent is not None and 100.0 - disk_used_percent <= config.disk_warning_percent:
        candidates.append(
            _candidate(
                node,
                kind="disk",
                level="warning",
                dedupe_key="disk-low",
                message=f"{node['name']} disk remaining is {100.0 - disk_used_percent:.1f}%.",
            )
        )

    exhaustion_at = node.get("forecast_exhaustion_at")
    if exhaustion_at:
        exhaustion = datetime.fromisoformat(exhaustion_at)
        if exhaustion <= datetime.now(UTC) + timedelta(days=config.forecast_days):
            candidates.append(
                _candidate(
                    node,
                    kind="forecast",
                    level="warning",
                    dedupe_key=_traffic_dedupe(node, "forecast"),
                    message=f"{node['name']} is forecast to exhaust bandwidth by {exhaustion.date().isoformat()}.",
                )
            )

    created: list[dict[str, Any]] = []
    active_keys = []
    for candidate in candidates:
        active_keys.append(candidate["dedupe_key"])
        was_created = db.upsert_alert(conn, **candidate)
        candidate["created"] = was_created
        candidate["title"] = f"VPSMonitor {candidate['level'].upper()}"
        created.append(candidate)
    db.resolve_alerts(conn, node_id, active_keys)
    return created


def evaluate_all_nodes(conn: Connection, config: AlertConfig) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for node in db.nodes_with_latest(conn):
        results.extend(evaluate_alerts_for_node(conn, node["id"], config))
    return results


def _candidate(node: dict[str, Any], *, kind: str, level: str, dedupe_key: str, message: str) -> dict[str, str]:
    return {
        "node_id": node["id"],
        "kind": kind,
        "level": level,
        "dedupe_key": dedupe_key,
        "message": message,
    }


def _traffic_dedupe(node: dict[str, Any], suffix: str) -> str:
    period = node.get("period_started_at") or "current"
    return f"traffic:{period}:{suffix}"
