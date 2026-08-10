import tempfile
import unittest
from pathlib import Path

from vpsmonitor.db import Database
from vpsmonitor.models import CollectorResult, Observation


class DatabaseTests(unittest.TestCase):
    def test_round_trip_latest_observation(self):
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
                self.assertEqual(latest[0]["raw"]["source"], "fixture")
                self.assertEqual(latest[0]["raw"]["sshPassword"], "[REDACTED]")
                self.assertEqual(
                    latest[0]["raw"]["nested"]["vnc_passwd"], "[REDACTED]"
                )
                self.assertEqual(db.recent_runs()[0]["ok"], 1)
            finally:
                db.close()


if __name__ == "__main__":
    unittest.main()
