from __future__ import annotations

from pathlib import Path
import json
import os
import subprocess
import sys

from fastapi.testclient import TestClient

from bandwidth_monitor_controller import db
from bandwidth_monitor_controller.app import create_app
from bandwidth_monitor_controller.config import load_config


SUBPROCESS_ENV = {
    **os.environ,
    "PYTHONPATH": os.pathsep.join(["packages/controller/src", "packages/agent/src", os.environ.get("PYTHONPATH", "")]),
}


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
        env=SUBPROCESS_ENV,
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
        env=SUBPROCESS_ENV,
        text=True,
    )
    payload = json.loads(create_result.stdout)
    assert payload["node_id"] == "cli-node"
    assert "VPSMON_NODE_TOKEN" in payload["agent_install_command"]
    assert payload["agent_pairing_url"].startswith("vpsmon-agent://join?")

    update_result = subprocess.run(
        [
            sys.executable,
            "-m",
            "bandwidth_monitor_controller",
            "update-node",
            "--config",
            str(config_path),
            "--id",
            "cli-node",
            "--name",
            "Updated CLI Node",
            "--provider",
            "RackNerd",
            "--country",
            "US",
        ],
        check=True,
        capture_output=True,
        env=SUBPROCESS_ENV,
        text=True,
    )
    updated_payload = json.loads(update_result.stdout)
    assert updated_payload["name"] == "Updated CLI Node"
    assert updated_payload["provider"] == "RackNerd"
    assert updated_payload["country"] == "US"

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
        env=SUBPROCESS_ENV,
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
        env=SUBPROCESS_ENV,
        text=True,
    )
    assert json.loads(delete_result.stdout)["deleted"] is True


def test_check_interval_settings_boundaries_and_node_override(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    config = load_config(config_path)
    with db.connect(config.database) as conn:
        db.init_db(conn)
        node_id, _ = db.create_node(conn, name="Interval Node", quota_gb=100)
        _, app_token = db.create_app_token(conn)

    client = TestClient(create_app(str(config_path)))
    headers = {"Authorization": f"Bearer {app_token}"}

    response = client.get("/api/v1/app/settings", headers=headers)
    assert response.status_code == 200
    assert response.json()["default_check_interval_seconds"] == 900
    assert response.json()["min_check_interval_seconds"] == 1
    assert response.json()["max_check_interval_seconds"] == 86400

    assert client.put("/api/v1/app/settings/check-interval", headers=headers, json={"seconds": 1}).status_code == 200
    assert client.put("/api/v1/app/settings/check-interval", headers=headers, json={"seconds": 86400}).status_code == 200
    assert client.put("/api/v1/app/settings/check-interval", headers=headers, json={"seconds": 0}).status_code == 422
    assert client.put("/api/v1/app/settings/check-interval", headers=headers, json={"seconds": 86401}).status_code == 422

    response = client.patch(
        f"/api/v1/app/nodes/{node_id}/settings",
        headers=headers,
        json={"check_interval_seconds_override": 1},
    )
    assert response.status_code == 200
    node = response.json()
    assert node["check_interval_seconds_override"] == 1
    assert node["effective_check_interval_seconds"] == 1
    assert node["check_interval_synced"] is False

    response = client.patch(
        f"/api/v1/app/nodes/{node_id}/settings",
        headers=headers,
        json={"check_interval_seconds_override": None},
    )
    assert response.status_code == 200
    node = response.json()
    assert node["check_interval_seconds_override"] is None
    assert node["effective_check_interval_seconds"] == 86400


def test_paused_node_ignores_reports_and_resolves_alerts(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    config = load_config(config_path)
    with db.connect(config.database) as conn:
        db.init_db(conn)
        node_id, node_token = db.create_node(conn, name="Pause Node", quota_gb=1)
        _, app_token = db.create_app_token(conn)

    client = TestClient(create_app(str(config_path)))
    app_headers = {"Authorization": f"Bearer {app_token}"}
    node_headers = {"Authorization": f"Bearer {node_token}"}

    response = client.post(
        "/api/v1/agent/report",
        headers=node_headers,
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
    assert response.json()["report_stored"] is True
    assert client.get("/api/v1/app/alerts", headers=app_headers).json()

    response = client.patch(
        f"/api/v1/app/nodes/{node_id}/settings",
        headers=app_headers,
        json={"monitoring_enabled": False},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "paused"
    assert client.get("/api/v1/app/alerts", headers=app_headers).json() == []

    response = client.post(
        "/api/v1/agent/report",
        headers=node_headers,
        json={
            "node_id": node_id,
            "cpu_percent": 99,
            "period_rx_bytes": 950_000_000,
            "period_tx_bytes": 0,
            "period_started_at": "2026-05-01T00:00:00+00:00",
        },
    )
    assert response.status_code == 200
    assert response.json()["monitoring_enabled"] is False
    assert response.json()["report_stored"] is False
    assert len(client.get(f"/api/v1/app/nodes/{node_id}", headers=app_headers).json()["history"]) == 1

    response = client.patch(
        f"/api/v1/app/nodes/{node_id}/settings",
        headers=app_headers,
        json={"monitoring_enabled": True},
    )
    assert response.status_code == 200
    assert response.json()["monitoring_enabled"] is True

    response = client.post(
        "/api/v1/agent/report",
        headers=node_headers,
        json={
            "node_id": node_id,
            "cpu_percent": 22,
            "period_rx_bytes": 100,
            "period_tx_bytes": 100,
            "period_started_at": "2026-05-01T00:00:00+00:00",
        },
    )
    assert response.status_code == 200
    assert response.json()["report_stored"] is True
    assert len(client.get(f"/api/v1/app/nodes/{node_id}", headers=app_headers).json()["history"]) == 2


def test_agent_report_tracks_check_interval_sync(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    config = load_config(config_path)
    with db.connect(config.database) as conn:
        db.init_db(conn)
        node_id, node_token = db.create_node(conn, name="Sync Node", quota_gb=100)
        _, app_token = db.create_app_token(conn)

    client = TestClient(create_app(str(config_path)))
    app_headers = {"Authorization": f"Bearer {app_token}"}
    node_headers = {"Authorization": f"Bearer {node_token}"}

    assert client.put("/api/v1/app/settings/check-interval", headers=app_headers, json={"seconds": 1}).status_code == 200
    response = client.post(
        "/api/v1/agent/report",
        headers=node_headers,
        json={"node_id": node_id, "applied_check_interval_seconds": 900},
    )
    assert response.status_code == 200
    assert response.json()["check_interval_seconds"] == 1
    node = client.get(f"/api/v1/app/nodes/{node_id}", headers=app_headers).json()
    assert node["applied_check_interval_seconds"] == 900
    assert node["effective_check_interval_seconds"] == 1
    assert node["check_interval_synced"] is False

    response = client.post(
        "/api/v1/agent/report",
        headers=node_headers,
        json={"node_id": node_id, "applied_check_interval_seconds": 1},
    )
    assert response.status_code == 200
    node = client.get(f"/api/v1/app/nodes/{node_id}", headers=app_headers).json()
    assert node["applied_check_interval_seconds"] == 1
    assert node["check_interval_synced"] is True


def test_static_web_mount_does_not_swallow_api_routes(tmp_path: Path, monkeypatch) -> None:
    web_dir = tmp_path / "web"
    assets_dir = web_dir / "assets"
    assets_dir.mkdir(parents=True)
    (web_dir / "index.html").write_text("<!doctype html><title>VPSMonitor</title><div id='root'></div>")
    (assets_dir / "app.js").write_text("console.log('ok')")
    monkeypatch.setenv("VPSMON_WEB_DIR", str(web_dir))

    config_path = write_config(tmp_path)
    client = TestClient(create_app(str(config_path)))

    response = client.get("/")
    assert response.status_code == 200
    assert "VPSMonitor" in response.text

    response = client.get("/assets/app.js")
    assert response.status_code == 200
    assert "console.log" in response.text

    response = client.get("/api/v1/missing")
    assert response.status_code == 404
