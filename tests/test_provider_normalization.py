from __future__ import annotations

import unittest

from vpsmonitor.collectors.panstar import PanstarCollector
from vpsmonitor.collectors.virtualizor import VirtualizorCollector
from vpsmonitor.collectors.aliyun_swas import AliyunSwasCollector


class ProviderNormalizationTests(unittest.TestCase):
    def test_aliyun_bandwidth_plan_is_marked_unlimited(self) -> None:
        collector = AliyunSwasCollector({}, timeout=1)

        result = collector._observation(
            "cn-hangzhou",
            "instance-1",
            {
                "InstanceName": "aliyun-one",
                "Status": "Running",
                "ResourceSpec": {
                    "Bandwidth": 200,
                    "Cpu": 2,
                    "Memory": 2,
                    "DiskSize": 40,
                },
            },
            {},
            {},
            None,
        )

        self.assertTrue(result.quota["traffic_unlimited"])
        self.assertEqual(result.quota["traffic_billing_mode"], "bandwidth")
        self.assertEqual(result.metadata["peak_bandwidth_mbps"], 200)

    def test_panstar_plan_and_traffic_units(self) -> None:
        collector = PanstarCollector({}, timeout=1)
        detail = {
            "data": {
                "id": 1,
                "name": "vm-one",
                "cpu": 1,
                "memory": 512,
                "disk": 10,
                "traffic": 512,
                "useTrafficIn": 100,
                "useTrafficOut": 200,
                "deliveryStatus": "READY",
                "expireTime": 1_800_000_000,
            }
        }

        result = collector._observation("1", {"id": 1}, detail)

        self.assertEqual(result.status, "READY")
        self.assertEqual(result.metrics["memory_total_bytes"], 512 * 1024**2)
        self.assertEqual(result.metrics["disk_total_bytes"], 10 * 1024**3)
        self.assertEqual(result.quota["traffic_used_bytes"], 300)
        self.assertEqual(result.quota["traffic_total_bytes"], 512 * 1024**3)

    def test_virtualizor_nested_resource_metrics(self) -> None:
        collector = VirtualizorCollector({}, timeout=1)
        raw = {
            "vpsmanage": {"info": {"status": 1}},
            "ram": {"ram": {"used": 800, "limit": 1000}},
            "cpu": {"cpu": {"percent": 12.5}},
            "disk": {"disk": {"used": 9000, "limit": 20480}},
            "bandwidth": {"bandwidth": {"used": 10800.5, "limit": 0}},
        }

        result = collector._observation("7", {"hostname": "vm-seven"}, raw)

        self.assertEqual(result.status, "running")
        self.assertEqual(result.metrics["cpu_percent"], 12.5)
        self.assertEqual(result.metrics["memory_total_bytes"], 1000 * 1024**2)
        self.assertEqual(result.metrics["disk_used_bytes"], 9000 * 1024**2)
        self.assertNotIn("traffic_total_bytes", result.quota)


if __name__ == "__main__":
    unittest.main()
