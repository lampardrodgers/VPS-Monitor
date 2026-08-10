from __future__ import annotations

import unittest

from vpsmonitor.collectors.virtfusion import VirtFusionCollector


class VirtFusionObservationTests(unittest.TestCase):
    def test_greencloud_state_values_take_precedence_over_plan_values(self) -> None:
        collector = VirtFusionCollector({}, timeout=1)
        raw = {
            "list_item": {"id": "server-1", "name": "fallback"},
            "detail": {
                "data": {
                    "id": "server-1",
                    "name": "green-1",
                    "cpu": "2 Core",
                    "memory": "1024 MB",
                    "network": {
                        "primary": {
                            "limit": "2 TB",
                            "period_start": "2026-08-01T00:00:00Z",
                            "period_end": "2026-09-01T00:00:00Z",
                        }
                    },
                    "state": {
                        "status": "running",
                        "cpu": "0.3 %",
                        "memory_used": "128 MB",
                        "network": {
                            "primary": {
                                "rx_rate": 123,
                                "tx_rate": 456,
                                "traffic": {
                                    "rx": "10 GB",
                                    "tx": "20 GB",
                                    "total": "30 GB",
                                },
                            }
                        },
                    },
                }
            },
        }

        observation = collector._observation("server-1", raw)

        self.assertEqual(observation.display_name, "green-1")
        self.assertEqual(observation.status, "running")
        self.assertEqual(observation.metrics["cpu_percent"], 0.3)
        self.assertEqual(observation.metrics["memory_used_bytes"], 128_000_000)
        self.assertEqual(observation.quota["traffic_used_bytes"], 30_000_000_000)
        self.assertEqual(observation.quota["traffic_total_bytes"], 2_000_000_000_000)


if __name__ == "__main__":
    unittest.main()
