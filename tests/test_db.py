import tempfile
import unittest
from pathlib import Path

from vpsmonitor.db import Database
from vpsmonitor.models import CollectorResult, Observation


class DatabaseTests(unittest.TestCase):
    def test_round_trip_keeps_normalized_data_without_raw_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Database(Path(directory) / "test.sqlite3")
            try:
                result = CollectorResult(
                    provider="test",
                    started_at="2026-08-10T00:00:00+00:00",
                    finished_at="2026-08-10T00:00:01+00:00",
                    observations=[
                        Observation(
                            provider="test",
                            instance_key="one",
                            display_name="One",
                            status="running",
                            metrics={"cpu_percent": 12.5},
                            quota={"traffic_used_bytes": 10},
                            raw={
                                "source": "fixture",
                                "sshPassword": "do-not-store",
                                "nested": {"vnc_passwd": "also-secret"},
                            },
                        )
                    ],
                )
                db.save_result(result)
                latest = db.latest()
                self.assertEqual(len(latest), 1)
                self.assertEqual(latest[0]["metrics"]["cpu_percent"], 12.5)
                self.assertEqual(latest[0]["raw"], {})
                self.assertEqual(db.recent_runs()[0]["ok"], 1)
            finally:
                db.close()

    def test_prune_history_keeps_only_retention_window_and_last_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Database(
                Path(directory) / "test.sqlite3",
                history_retention_days=7,
                run_retention_days=30,
            )
            try:
                def save(day: int, keys: tuple[str, ...]) -> None:
                    timestamp = f"2026-01-{day:02d}T00:00:00+00:00"
                    db.save_result(
                        CollectorResult(
                            provider="test",
                            started_at=timestamp,
                            finished_at=timestamp,
                            observations=[
                                Observation(
                                    provider="test",
                                    instance_key=key,
                                    display_name=key,
                                    observed_at=timestamp,
                                    raw={"large": "payload"},
                                )
                                for key in keys
                            ],
                        )
                    )

                save(1, ("active", "removed"))
                save(8, ("active",))
                save(31, ("active",))

                deleted = db.prune_history(reference_at="2026-02-10T00:00:00+00:00")

                self.assertEqual(deleted, {"observations": 2, "collector_runs": 2})
                rows = db.connection.execute(
                    "SELECT instance_key, observed_at, raw_json FROM observations ORDER BY id"
                ).fetchall()
                self.assertEqual(
                    [(row["instance_key"], row["observed_at"]) for row in rows],
                    [
                        ("removed", "2026-01-01T00:00:00+00:00"),
                        ("active", "2026-01-31T00:00:00+00:00"),
                    ],
                )
                self.assertTrue(all(row["raw_json"] == "{}" for row in rows))
                self.assertEqual(len(db.recent_runs()), 1)
                self.assertEqual(db.recent_runs()[0]["finished_at"], "2026-01-31T00:00:00+00:00")
                all_latest = {
                    row["instance_key"]: row for row in db.latest(include_removed=True)
                }
                self.assertEqual(set(all_latest), {"active", "removed"})
                self.assertEqual(all_latest["removed"]["active"], 0)
            finally:
                db.close()

    def test_runtime_retention_settings_override_config_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Database(
                Path(directory) / "test.sqlite3",
                history_retention_days=7,
                run_retention_days=30,
            )
            try:
                initial = db.retention_settings()
                self.assertEqual(initial["history_retention_days"], 7)
                self.assertEqual(initial["run_retention_days"], 30)

                updated = db.update_retention_settings(
                    history_retention_days=14,
                    run_retention_days=60,
                )
                self.assertEqual(updated["history_retention_days"], 14)
                self.assertEqual(updated["run_retention_days"], 60)

                with self.assertRaises(ValueError):
                    db.update_retention_settings(
                        history_retention_days=0,
                        run_retention_days=30,
                    )
            finally:
                db.close()

    def test_successful_inventory_reconciliation_preserves_removed_history(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Database(Path(directory) / "test.sqlite3")
            try:
                db.save_result(
                    CollectorResult(
                        provider="test",
                        started_at="2026-08-10T00:00:00+00:00",
                        finished_at="2026-08-10T00:00:01+00:00",
                        observations=[
                            Observation(
                                provider="test",
                                instance_key="kept",
                                display_name="Kept",
                                observed_at="2026-08-10T00:00:00+00:00",
                            ),
                            Observation(
                                provider="test",
                                instance_key="removed",
                                display_name="Removed",
                                observed_at="2026-08-10T00:00:00+00:00",
                            ),
                        ],
                    )
                )
                db.save_result(
                    CollectorResult(
                        provider="test",
                        started_at="2026-08-10T00:05:00+00:00",
                        finished_at="2026-08-10T00:05:01+00:00",
                        observations=[
                            Observation(
                                provider="test",
                                instance_key="kept",
                                display_name="Kept",
                                observed_at="2026-08-10T00:05:00+00:00",
                            )
                        ],
                    )
                )

                self.assertEqual([row["instance_key"] for row in db.latest()], ["kept"])
                all_rows = {row["instance_key"]: row for row in db.latest(include_removed=True)}
                self.assertEqual(set(all_rows), {"kept", "removed"})
                self.assertEqual(all_rows["kept"]["active"], 1)
                self.assertEqual(all_rows["removed"]["active"], 0)
                self.assertEqual(
                    all_rows["removed"]["removed_at"],
                    "2026-08-10T00:05:01+00:00",
                )

                db.save_result(
                    CollectorResult(
                        provider="test",
                        started_at="2026-08-10T00:10:00+00:00",
                        finished_at="2026-08-10T00:10:01+00:00",
                        error="temporary failure",
                    )
                )
                self.assertEqual([row["instance_key"] for row in db.latest()], ["kept"])
            finally:
                db.close()


if __name__ == "__main__":
    unittest.main()
