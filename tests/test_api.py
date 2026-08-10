from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from vpsmonitor.api import create_app
from vpsmonitor.db import Database
from vpsmonitor.models import CollectorResult, Observation


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        database_path = root / "data" / "monitor.sqlite3"
        config_path = root / "config" / "providers.yaml"
        config_path.parent.mkdir(parents=True)
        config_path.write_text(
            "storage:\n"
            f"  database: {database_path}\n"
            "providers: {}\n",
            encoding="utf-8",
        )
        now = datetime.now(UTC).replace(microsecond=0)
        db = Database(database_path)
        try:
            for index, cpu in enumerate((10.0, 20.0)):
                observed_at = (now - timedelta(minutes=5 - index)).isoformat()
                db.save_result(
                    CollectorResult(
                        provider="example",
                        started_at=observed_at,
                        finished_at=observed_at,
                        observations=[
                            Observation(
                                provider="example",
                                instance_key="vm-1",
                                display_name="Example VM",
                                observed_at=observed_at,
                                status="running",
                                metrics={"cpu_percent": cpu},
                                quota={
                                    "traffic_used_bytes": 100,
                                    "traffic_total_bytes": 1000,
                                },
                                metadata={"region": "test"},
                                raw={"sshPassword": "must-not-leak"},
                            )
                        ],
                    )
                )
        finally:
            db.close()
        self.client = TestClient(create_app(config_path))

    def tearDown(self) -> None:
        self.client.close()
        self.temporary.cleanup()

    def test_health_and_openapi(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        schema = self.client.get("/openapi.json").json()
        self.assertIn("/api/v1/instances", schema["paths"])

    def test_latest_instances_are_filtered_and_do_not_expose_raw(self) -> None:
        response = self.client.get("/api/v1/instances", params={"search": "example"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["items"][0]["metrics"]["cpu_percent"], 20.0)
        self.assertNotIn("raw", payload["items"][0])

    def test_provider_history_and_summary(self) -> None:
        providers = self.client.get("/api/v1/providers").json()["items"]
        self.assertEqual(providers[0]["provider"], "example")
        self.assertTrue(providers[0]["ok"])
        history = self.client.get(
            "/api/v1/instances/example/vm-1/history", params={"hours": 1}
        ).json()
        self.assertEqual(len(history["points"]), 2)
        summary = self.client.get("/api/v1/summary").json()
        self.assertEqual(summary["instances_total"], 1)
        self.assertEqual(summary["instances_online"], 1)
        self.assertEqual(summary["traffic_used_bytes"], 100)

    def test_missing_instance_returns_404(self) -> None:
        response = self.client.get("/api/v1/instances/example/missing")
        self.assertEqual(response.status_code, 404)

    def test_localhost_cors(self) -> None:
        response = self.client.options(
            "/api/v1/instances",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "cache-control,pragma",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"], "http://localhost:5173"
        )
        allowed_headers = response.headers["access-control-allow-headers"].lower()
        self.assertIn("cache-control", allowed_headers)
        self.assertIn("pragma", allowed_headers)

    def test_live_aliyun_coalesces_requests_without_raw(self) -> None:
        config_path = Path(self.temporary.name) / "config" / "providers.yaml"
        config_text = config_path.read_text(encoding="utf-8")
        config_path.write_text(
            config_text.replace(
                "providers: {}\n",
                "providers:\n  aliyun_swas:\n    enabled: true\n",
            ),
            encoding="utf-8",
        )

        observation = Observation(
            provider="aliyun_swas",
            instance_key="swas-1",
            display_name="Aliyun Live",
            status="Running",
            metrics={"cpu_percent": 7.5},
            quota={"traffic_unlimited": True},
            metadata={"region_id": "cn-hangzhou"},
            raw={"AccessKeySecret": "must-not-leak"},
        )
        with patch("vpsmonitor.api.AliyunSwasCollector") as collector_class:
            collector_class.return_value.collect.return_value = [observation]
            first = self.client.get("/api/v1/live/aliyun_swas")
            second = self.client.get("/api/v1/live/aliyun_swas")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(collector_class.return_value.collect.call_count, 1)
        self.assertEqual(first.headers["cache-control"], "no-store")
        self.assertEqual(first.headers["x-vpsmonitor-live-cache"], "miss")
        self.assertEqual(second.headers["x-vpsmonitor-live-cache"], "hit")
        self.assertEqual(first.json()["items"][0]["metrics"]["cpu_percent"], 7.5)
        self.assertNotIn("raw", first.json()["items"][0])


if __name__ == "__main__":
    unittest.main()
