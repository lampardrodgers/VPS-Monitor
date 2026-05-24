from __future__ import annotations

from bandwidth_monitor_agent.metrics import _latest_vnstat_month, _traffic_value


def test_vnstat_latest_month_parser() -> None:
    payload = {
        "interfaces": [
            {
                "name": "eth0",
                "traffic": {
                    "month": [
                        {"date": {"year": 2026, "month": 4}, "rx": 1, "tx": 2},
                        {"date": {"year": 2026, "month": 5}, "rx": 3, "tx": 4},
                    ]
                },
            }
        ]
    }
    entry = _latest_vnstat_month(payload, "eth0")
    assert entry is not None
    assert entry["rx"] == 3
    assert entry["tx"] == 4


def test_traffic_value_accepts_nested_bytes() -> None:
    assert _traffic_value(10) == 10
    assert _traffic_value({"bytes": 20}) == 20
    assert _traffic_value({"value": 30}) == 30
    assert _traffic_value("bad") is None
