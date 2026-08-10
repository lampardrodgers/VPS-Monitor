from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .models import CollectorResult, Observation
from .util import compact_json, redact_sensitive


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
"""


class Database:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(SCHEMA)
        self._sanitize_existing_raw()

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
                compact_json(redact_sensitive(item.raw)),
            ),
        )

    def _sanitize_existing_raw(self) -> None:
        rows = self.connection.execute("SELECT id, raw_json FROM observations").fetchall()
        updates: list[tuple[str, int]] = []
        for row in rows:
            try:
                raw = json.loads(row["raw_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            sanitized = compact_json(redact_sensitive(raw))
            if sanitized != row["raw_json"]:
                updates.append((sanitized, row["id"]))
        if updates:
            with self.connection:
                self.connection.executemany(
                    "UPDATE observations SET raw_json = ? WHERE id = ?", updates
                )

    def latest(self) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """
            SELECT o.*
            FROM observations o
            JOIN (
                SELECT provider, instance_key, MAX(id) AS max_id
                FROM observations
                GROUP BY provider, instance_key
            ) latest ON latest.max_id = o.id
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
