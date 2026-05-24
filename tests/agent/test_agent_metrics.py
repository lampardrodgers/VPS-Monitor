from __future__ import annotations

from bandwidth_monitor_agent.metrics import _latest_vnstat_month, _traffic_value
from bandwidth_monitor_agent.timer import apply_timer_interval, read_timer_interval_seconds, render_timer_unit


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


def test_timer_unit_uses_seconds_interval(tmp_path) -> None:
    timer_path = tmp_path / "vpsmon-agent.timer"
    timer_path.write_text(render_timer_unit(1))
    assert "OnUnitActiveSec=1s" in timer_path.read_text()
    assert read_timer_interval_seconds(timer_path) == 1

    timer_path.write_text(render_timer_unit(86400))
    assert "OnUnitActiveSec=86400s" in timer_path.read_text()
    assert read_timer_interval_seconds(timer_path) == 86400


def test_timer_sync_noops_when_current_interval_matches(tmp_path) -> None:
    timer_path = tmp_path / "vpsmon-agent.timer"
    timer_path.write_text(render_timer_unit(30))

    result = apply_timer_interval(30, timer_path=timer_path)

    assert result["applied"] is True
    assert result["changed"] is False
    assert result["current_interval_seconds"] == 30


def test_timer_sync_reports_systemd_unavailable(tmp_path, monkeypatch) -> None:
    timer_path = tmp_path / "vpsmon-agent.timer"
    timer_path.write_text(render_timer_unit(30))
    monkeypatch.setattr("bandwidth_monitor_agent.timer.shutil.which", lambda _: None)

    result = apply_timer_interval(60, timer_path=timer_path)

    assert result["applied"] is False
    assert result["changed"] is False
    assert "systemctl" in str(result["error"])
    assert read_timer_interval_seconds(timer_path) == 30
