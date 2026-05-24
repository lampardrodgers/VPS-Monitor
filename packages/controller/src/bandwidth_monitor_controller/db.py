from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from sqlite3 import Connection, Row
from typing import Any
import json
import sqlite3
import uuid

from .security import hash_token, new_token


def connect(path: Path) -> Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT '',
            country TEXT NOT NULL DEFAULT '',
            quota_bytes INTEGER,
            cycle_day INTEGER NOT NULL DEFAULT 1,
            counting_mode TEXT NOT NULL DEFAULT 'total',
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            collected_at TEXT NOT NULL,
            cpu_percent REAL,
            memory_total_bytes INTEGER,
            memory_used_bytes INTEGER,
            disk_total_bytes INTEGER,
            disk_used_bytes INTEGER,
            rx_bytes INTEGER,
            tx_bytes INTEGER,
            period_rx_bytes INTEGER,
            period_tx_bytes INTEGER,
            period_started_at TEXT,
            raw_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_reports_node_time
            ON reports(node_id, collected_at DESC);

        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            opened_at TEXT NOT NULL,
            resolved_at TEXT,
            dedupe_key TEXT NOT NULL,
            UNIQUE(node_id, dedupe_key)
        );

        CREATE TABLE IF NOT EXISTS app_tokens (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            last_used_at TEXT
        );
        """
    )
    conn.commit()


def utc_now() -> datetime:
    return datetime.now(UTC)


def to_iso(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat()


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def create_node(
    conn: Connection,
    *,
    name: str,
    provider: str = "",
    country: str = "",
    quota_gb: float | None = None,
    cycle_day: int = 1,
    counting_mode: str = "total",
    node_id: str | None = None,
) -> tuple[str, str]:
    node_id = node_id or _slugify(name)
    token = new_token("node")
    now = to_iso()
    quota_bytes = int(quota_gb * 1024**3) if quota_gb is not None else None
    conn.execute(
        """
        INSERT INTO nodes (
            id, name, provider, country, quota_bytes, cycle_day, counting_mode,
            token_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            node_id,
            name,
            provider,
            country,
            quota_bytes,
            cycle_day,
            counting_mode,
            hash_token(token),
            now,
            now,
        ),
    )
    conn.commit()
    return node_id, token


def delete_node(conn: Connection, node_id: str) -> bool:
    before = conn.total_changes
    conn.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
    conn.commit()
    return conn.total_changes > before


def create_app_token(conn: Connection, *, name: str = "iOS App") -> tuple[str, str]:
    token_id = str(uuid.uuid4())
    token = new_token("app")
    conn.execute(
        """
        INSERT INTO app_tokens (id, name, token_hash, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (token_id, name, hash_token(token), to_iso()),
    )
    conn.commit()
    return token_id, token


def authenticate_node(conn: Connection, token: str) -> Row | None:
    row = conn.execute(
        "SELECT * FROM nodes WHERE token_hash = ?",
        (hash_token(token),),
    ).fetchone()
    return row


def authenticate_app(conn: Connection, token: str) -> Row | None:
    row = conn.execute(
        "SELECT * FROM app_tokens WHERE token_hash = ?",
        (hash_token(token),),
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE app_tokens SET last_used_at = ? WHERE id = ?",
            (to_iso(), row["id"]),
        )
        conn.commit()
    return row


def insert_report(conn: Connection, node_id: str, payload: dict[str, Any]) -> None:
    collected_at = payload.get("collected_at") or to_iso()
    raw_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    conn.execute(
        """
        INSERT INTO reports (
            node_id, collected_at, cpu_percent, memory_total_bytes, memory_used_bytes,
            disk_total_bytes, disk_used_bytes, rx_bytes, tx_bytes, period_rx_bytes,
            period_tx_bytes, period_started_at, raw_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            node_id,
            collected_at,
            payload.get("cpu_percent"),
            payload.get("memory_total_bytes"),
            payload.get("memory_used_bytes"),
            payload.get("disk_total_bytes"),
            payload.get("disk_used_bytes"),
            payload.get("rx_bytes"),
            payload.get("tx_bytes"),
            payload.get("period_rx_bytes"),
            payload.get("period_tx_bytes"),
            payload.get("period_started_at"),
            raw_json,
            to_iso(),
        ),
    )
    conn.commit()


def latest_report(conn: Connection, node_id: str) -> Row | None:
    return conn.execute(
        """
        SELECT * FROM reports
        WHERE node_id = ?
        ORDER BY collected_at DESC, id DESC
        LIMIT 1
        """,
        (node_id,),
    ).fetchone()


def nodes_with_latest(conn: Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT
            n.*,
            r.collected_at,
            r.cpu_percent,
            r.memory_total_bytes,
            r.memory_used_bytes,
            r.disk_total_bytes,
            r.disk_used_bytes,
            r.rx_bytes,
            r.tx_bytes,
            r.period_rx_bytes,
            r.period_tx_bytes,
            r.period_started_at
        FROM nodes n
        LEFT JOIN reports r ON r.id = (
            SELECT id FROM reports
            WHERE node_id = n.id
            ORDER BY collected_at DESC, id DESC
            LIMIT 1
        )
        ORDER BY n.name COLLATE NOCASE
        """
    ).fetchall()
    return [dict(row) for row in rows]


def recent_reports(conn: Connection, node_id: str, days: int) -> list[dict[str, Any]]:
    since = to_iso(utc_now() - timedelta(days=days))
    rows = conn.execute(
        """
        SELECT * FROM reports
        WHERE node_id = ? AND collected_at >= ?
        ORDER BY collected_at ASC, id ASC
        """,
        (node_id, since),
    ).fetchall()
    return [dict(row) for row in rows]


def node_by_id(conn: Connection, node_id: str) -> dict[str, Any] | None:
    rows = [row for row in nodes_with_latest(conn) if row["id"] == node_id]
    return rows[0] if rows else None


def list_alerts(conn: Connection, include_resolved: bool = False) -> list[dict[str, Any]]:
    where = "" if include_resolved else "WHERE resolved_at IS NULL"
    rows = conn.execute(
        f"""
        SELECT a.*, n.name AS node_name
        FROM alerts a
        JOIN nodes n ON n.id = a.node_id
        {where}
        ORDER BY a.opened_at DESC
        """
    ).fetchall()
    return [dict(row) for row in rows]


def upsert_alert(
    conn: Connection,
    *,
    node_id: str,
    kind: str,
    level: str,
    message: str,
    dedupe_key: str,
) -> bool:
    before = conn.total_changes
    conn.execute(
        """
        INSERT OR IGNORE INTO alerts (
            node_id, kind, level, message, opened_at, dedupe_key
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (node_id, kind, level, message, to_iso(), dedupe_key),
    )
    conn.commit()
    return conn.total_changes > before


def resolve_alerts(conn: Connection, node_id: str, active_dedupe_keys: Iterable[str]) -> None:
    active = set(active_dedupe_keys)
    rows = conn.execute(
        "SELECT id, dedupe_key FROM alerts WHERE node_id = ? AND resolved_at IS NULL",
        (node_id,),
    ).fetchall()
    for row in rows:
        if row["dedupe_key"] not in active:
            conn.execute(
                "UPDATE alerts SET resolved_at = ? WHERE id = ?",
                (to_iso(), row["id"]),
            )
    conn.commit()


def _slugify(value: str) -> str:
    candidate = "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")
    candidate = "-".join(part for part in candidate.split("-") if part)
    return candidate or f"node-{uuid.uuid4().hex[:8]}"
