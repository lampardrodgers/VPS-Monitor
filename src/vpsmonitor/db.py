from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .models import CollectorResult, Observation
from .util import compact_json


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS collector_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    ok INTEGER NOT NULL,
    observation_count INTEGER NOT NULL,
    error TEXT
);

CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    instance_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    status TEXT,
    metrics_json TEXT NOT NULL,
    quota_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observations_lookup
ON observations(provider, instance_key, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_observations_time
ON observations(observed_at);

CREATE INDEX IF NOT EXISTS idx_collector_runs_time
ON collector_runs(finished_at);

CREATE TABLE IF NOT EXISTS provider_inventory (
    provider TEXT NOT NULL,
    instance_key TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    removed_at TEXT,
    PRIMARY KEY (provider, instance_key)
);

CREATE INDEX IF NOT EXISTS idx_provider_inventory_active
ON provider_inventory(provider, active);

CREATE TABLE IF NOT EXISTS runtime_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

MIN_RETENTION_DAYS = 1
MAX_RETENTION_DAYS = 3650


class Database:
    def __init__(
        self,
        path: Path,
        *,
        history_retention_days: int = 7,
        run_retention_days: int = 30,
    ):
        self.path = path
        self.history_retention_days = max(1, history_retention_days)
        self.run_retention_days = max(1, run_retention_days)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(SCHEMA)
        self._bootstrap_inventory()
        self._ensure_retention_settings()
        self._drop_existing_raw()

    def close(self) -> None:
        self.connection.close()

    def save_result(self, result: CollectorResult) -> None:
        with self.connection:
            for observation in result.observations:
                self._save_observation(observation)
            self.connection.execute(
                """
                INSERT INTO collector_runs
                    (provider, started_at, finished_at, ok, observation_count, error)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    result.provider,
                    result.started_at,
                    result.finished_at,
                    int(result.ok),
                    len(result.observations),
                    result.error,
                ),
            )
            if result.ok:
                self._update_inventory(result)

    def _save_observation(self, item: Observation) -> None:
        self.connection.execute(
            """
            INSERT INTO observations
                (provider, instance_key, display_name, observed_at, status,
                 metrics_json, quota_json, metadata_json, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item.provider,
                item.instance_key,
                item.display_name,
                item.observed_at,
                item.status,
                compact_json(item.metrics),
                compact_json(item.quota),
                compact_json(item.metadata),
                "{}",
            ),
        )

    def _drop_existing_raw(self) -> None:
        """Discard provider payloads; normalized fields are the durable record."""
        with self.connection:
            self.connection.execute(
                "UPDATE observations SET raw_json = '{}' WHERE raw_json <> '{}'"
            )

    def _ensure_retention_settings(self) -> None:
        now = datetime.now(UTC).isoformat(timespec="seconds")
        with self.connection:
            self.connection.executemany(
                """
                INSERT OR IGNORE INTO runtime_settings(key, value, updated_at)
                VALUES (?, ?, ?)
                """,
                (
                    ("history_retention_days", str(self.history_retention_days), now),
                    ("run_retention_days", str(self.run_retention_days), now),
                ),
            )

    def retention_settings(self) -> dict[str, Any]:
        rows = self.connection.execute(
            """
            SELECT key, value, updated_at FROM runtime_settings
            WHERE key IN ('history_retention_days', 'run_retention_days')
            """
        ).fetchall()
        values = {row["key"]: row for row in rows}
        history = _retention_value(
            values.get("history_retention_days"), self.history_retention_days
        )
        runs = _retention_value(values.get("run_retention_days"), self.run_retention_days)
        updated = max((row["updated_at"] for row in rows), default=None)
        return {
            "history_retention_days": history,
            "run_retention_days": runs,
            "updated_at": updated,
        }

    def update_retention_settings(
        self,
        *,
        history_retention_days: int,
        run_retention_days: int,
    ) -> dict[str, Any]:
        history = _validate_retention_days(history_retention_days)
        runs = _validate_retention_days(run_retention_days)
        now = datetime.now(UTC).isoformat(timespec="seconds")
        with self.connection:
            self.connection.executemany(
                """
                INSERT INTO runtime_settings(key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (
                    ("history_retention_days", str(history), now),
                    ("run_retention_days", str(runs), now),
                ),
            )
        return self.retention_settings()

    def prune_history(self, *, reference_at: str | None = None) -> dict[str, int]:
        """Apply bounded retention while preserving each instance/provider's last row."""
        reference = _parse_timestamp(reference_at) if reference_at else datetime.now(UTC)
        settings = self.retention_settings()
        history_cutoff = (reference - timedelta(days=settings["history_retention_days"])).isoformat(
            timespec="seconds"
        )
        run_cutoff = (reference - timedelta(days=settings["run_retention_days"])).isoformat(
            timespec="seconds"
        )
        with self.connection:
            observations = self.connection.execute(
                """
                DELETE FROM observations
                WHERE observed_at < ?
                  AND id NOT IN (
                      SELECT MAX(id) FROM observations GROUP BY provider, instance_key
                  )
                """,
                (history_cutoff,),
            ).rowcount
            runs = self.connection.execute(
                """
                DELETE FROM collector_runs
                WHERE finished_at < ?
                  AND id NOT IN (
                      SELECT MAX(id) FROM collector_runs GROUP BY provider
                  )
                """,
                (run_cutoff,),
            ).rowcount
        return {"observations": observations, "collector_runs": runs}

    def _bootstrap_inventory(self) -> None:
        """Create active inventory rows for databases written by older versions."""
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO provider_inventory
                    (provider, instance_key, active, first_seen_at, last_seen_at, removed_at)
                SELECT provider, instance_key, 1, MIN(observed_at), MAX(observed_at), NULL
                FROM observations o
                WHERE NOT EXISTS (
                    SELECT 1 FROM provider_inventory i
                    WHERE i.provider = o.provider AND i.instance_key = o.instance_key
                )
                GROUP BY provider, instance_key
                """
            )

    def _update_inventory(self, result: CollectorResult) -> None:
        """Reconcile a provider only after a successful, authoritative collection."""
        seen = {item.instance_key: item.observed_at for item in result.observations}
        if seen:
            placeholders = ",".join("?" for _ in seen)
            self.connection.execute(
                f"""
                UPDATE provider_inventory
                SET active = 0, removed_at = COALESCE(removed_at, ?)
                WHERE provider = ? AND active = 1
                  AND instance_key NOT IN ({placeholders})
                """,
                (result.finished_at, result.provider, *seen),
            )
        else:
            self.connection.execute(
                """
                UPDATE provider_inventory
                SET active = 0, removed_at = COALESCE(removed_at, ?)
                WHERE provider = ? AND active = 1
                """,
                (result.finished_at, result.provider),
            )
        for instance_key, observed_at in seen.items():
            self.connection.execute(
                """
                INSERT INTO provider_inventory
                    (provider, instance_key, active, first_seen_at, last_seen_at, removed_at)
                VALUES (?, ?, 1, ?, ?, NULL)
                ON CONFLICT(provider, instance_key) DO UPDATE SET
                    active = 1,
                    last_seen_at = excluded.last_seen_at,
                    removed_at = NULL
                """,
                (result.provider, instance_key, observed_at, observed_at),
            )

    def latest(self, *, include_removed: bool = False) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            f"""
            SELECT o.*, i.active, i.removed_at
            FROM observations o
            JOIN (
                SELECT provider, instance_key, MAX(id) AS max_id
                FROM observations
                GROUP BY provider, instance_key
            ) latest ON latest.max_id = o.id
            JOIN provider_inventory i
              ON i.provider = o.provider AND i.instance_key = o.instance_key
            {'' if include_removed else 'WHERE i.active = 1'}
            ORDER BY o.provider, o.display_name
            """
        ).fetchall()
        return [self._decode(row) for row in rows]

    def recent_runs(self) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """
            SELECT r.* FROM collector_runs r
            JOIN (
                SELECT provider, MAX(id) AS max_id
                FROM collector_runs GROUP BY provider
            ) latest ON latest.max_id = r.id
            ORDER BY r.provider
            """
        ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _decode(row: sqlite3.Row) -> dict[str, Any]:
        value = dict(row)
        for key in ("metrics_json", "quota_json", "metadata_json", "raw_json"):
            value[key.removesuffix("_json")] = json.loads(value.pop(key))
        return value


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _retention_value(row: sqlite3.Row | None, fallback: int) -> int:
    if row is None:
        return _validate_retention_days(fallback)
    try:
        return _validate_retention_days(int(row["value"]))
    except (TypeError, ValueError):
        return _validate_retention_days(fallback)


def _validate_retention_days(value: int) -> int:
    if isinstance(value, bool) or not MIN_RETENTION_DAYS <= value <= MAX_RETENTION_DAYS:
        raise ValueError(
            f"保留天数必须在 {MIN_RETENTION_DAYS}–{MAX_RETENTION_DAYS} 之间"
        )
    return value
