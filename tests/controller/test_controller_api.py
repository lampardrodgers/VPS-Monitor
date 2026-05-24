from __future__ import annotations

from pathlib import Path
import json
import subprocess
import sys

from fastapi.testclient import TestClient

from bandwidth_monitor_controller import db
from bandwidth_monitor_controller.app import create_app
from bandwidth_monitor_controller.config import load_config


def write_config(tmp_path: Path) -> Path:
    config_path = tmp_path / "controller.yaml"
    config_path.write_text(
        f"""
database: {tmp_path / "controller.sqlite3"}
alerts:
  stale_after_minutes: 45
  disk_warning_percent: 15
  traffic_warning_percent: 25
  traffic_critical_percent: 10
  forecast_days: 7
  forecast_window_days: 3
notifications:
  telegram:
    enabled: false
  bark:
    enabled: false
""".strip()
    )
    return config_path


def test_agent_report_and_app_read(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    config = load_config(config_path)
    with db.connect(config.database) as conn:
        db.init_db(conn)
        node_id, node_token = db.create_node(conn, name="Tokyo", quota_gb=1000)
        _, app_token = db.create_app_token(conn)

    client = TestClient(create_app(str(config_path)))
    response = client.post(
        "/api/v1/agent/report",
        headers={"Authorization": f"Bearer {node_token}"},
        json={
            "node_id": node_id,
            "cpu_percent": 12.5,
            "memory_total_bytes": 1000,
            "memory_used_bytes": 400,
            "disk_total_bytes": 1000,
            "disk_used_bytes": 250,
            "rx_bytes": 100,
            "tx_bytes": 200,
            "period_rx_bytes": 100,
            "period_tx_bytes": 200,
            "period_started_at": "2026-05-01T00:00:00+00:00",
        },
    )
    assert response.status_code == 200

    response = client.get("/api/v1/app/nodes", headers={"Authorization": f"Bearer {app_token}"})
    assert response.status_code == 200
    nodes = response.json()
    assert len(nodes) == 1
    assert nodes[0]["name"] == "Tokyo"
    assert nodes[0]["period_used_bytes"] == 300
    assert nodes[0]["status"] == "ok"


def test_traffic_warning_alert(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    config = load_config(config_path)
    with db.connect(config.database) as conn:
        db.init_db(conn)
        node_id, node_token = db.create_node(conn, name="Low Traffic", quota_gb=1)
        _, app_token = db.create_app_token(conn)

    client = TestClient(create_app(str(config_path)))
    response = client.post(
        "/api/v1/agent/report",
        headers={"Authorization": f"Bearer {node_token}"},
        json={
            "node_id": node_id,
            "disk_total_bytes": 100,
            "disk_used_bytes": 10,
            "period_rx_bytes": 900_000_000,
            "period_tx_bytes": 0,
            "period_started_at": "2026-05-01T00:00:00+00:00",
        },
    )
    assert response.status_code == 200

    response = client.get("/api/v1/app/alerts", headers={"Authorization": f"Bearer {app_token}"})
    assert response.status_code == 200
    alerts = response.json()
    assert alerts
    assert alerts[0]["kind"] == "traffic"


def test_controller_cli_join_and_delete(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    init_result = subprocess.run(
        [
            sys.executable,
            "-m",
            "bandwidth_monitor_controller",
            "init-db",
            "--config",
            str(config_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert "ready" in init_result.stdout

    create_result = subprocess.run(
        [
            sys.executable,
            "-m",
            "bandwidth_monitor_controller",
            "create-node",
            "--config",
            str(config_path),
            "--name",
            "CLI Node",
            "--id",
            "cli-node",
            "--quota-gb",
            "100",
            "--controller-url",
            "https://monitor.example.com",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(create_result.stdout)
    assert payload["node_id"] == "cli-node"
    assert "VPSMON_NODE_TOKEN" in payload["agent_install_command"]
    assert payload["agent_pairing_url"].startswith("vpsmon-agent://join?")

    list_result = subprocess.run(
        [
            sys.executable,
            "-m",
            "bandwidth_monitor_controller",
            "list-nodes",
            "--config",
            str(config_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert "cli-node" in list_result.stdout

    delete_result = subprocess.run(
        [
            sys.executable,
            "-m",
            "bandwidth_monitor_controller",
            "delete-node",
            "--config",
            str(config_path),
            "--id",
            "cli-node",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(delete_result.stdout)["deleted"] is True
