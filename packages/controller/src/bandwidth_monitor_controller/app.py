from __future__ import annotations

from collections.abc import Generator
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlite3 import Connection

from . import db
from .analytics import build_node_view
from .config import ControllerConfig, load_config
from .notifications import send_notification
from .security import bearer_token
from .service import evaluate_alerts_for_node


class AgentReport(BaseModel):
    node_id: str | None = None
    collected_at: str | None = None
    cpu_percent: float | None = Field(default=None, ge=0)
    memory_total_bytes: int | None = None
    memory_used_bytes: int | None = None
    disk_total_bytes: int | None = None
    disk_used_bytes: int | None = None
    rx_bytes: int | None = None
    tx_bytes: int | None = None
    period_rx_bytes: int | None = None
    period_tx_bytes: int | None = None
    period_started_at: str | None = None
    applied_check_interval_seconds: int | None = Field(
        default=None,
        ge=db.MIN_CHECK_INTERVAL_SECONDS,
        le=db.MAX_CHECK_INTERVAL_SECONDS,
    )
    raw: dict[str, Any] = Field(default_factory=dict)


class CheckIntervalUpdate(BaseModel):
    seconds: int = Field(ge=db.MIN_CHECK_INTERVAL_SECONDS, le=db.MAX_CHECK_INTERVAL_SECONDS)


class NodeSettingsUpdate(BaseModel):
    monitoring_enabled: bool | None = None
    check_interval_seconds_override: int | None = Field(
        default=None,
        ge=db.MIN_CHECK_INTERVAL_SECONDS,
        le=db.MAX_CHECK_INTERVAL_SECONDS,
    )


def create_app(config_path: str) -> FastAPI:
    config = load_config(config_path)
    app = FastAPI(title="VPSMonitor Controller", version="0.1.0")
    app.state.config = config

    with db.connect(config.database) as conn:
        db.init_db(conn)

    def get_db() -> Generator[Connection, None, None]:
        conn = db.connect(config.database)
        try:
            yield conn
        finally:
            conn.close()

    def require_node(
        authorization: str | None = Header(default=None),
        conn: Connection = Depends(get_db),
    ):
        token = bearer_token(authorization)
        if not token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
        node = db.authenticate_node(conn, token)
        if not node:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid node token")
        return node

    def require_app(
        authorization: str | None = Header(default=None),
        conn: Connection = Depends(get_db),
    ):
        token = bearer_token(authorization)
        if not token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
        app_token = db.authenticate_app(conn, token)
        if not app_token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid app token")
        return app_token

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/v1/agent/report")
    def post_agent_report(
        report: AgentReport,
        node=Depends(require_node),
        conn: Connection = Depends(get_db),
    ) -> dict[str, Any]:
        payload = report.model_dump()
        target_interval = db.effective_check_interval(conn, node)
        if report.applied_check_interval_seconds is not None:
            db.mark_check_interval_applied(conn, node["id"], report.applied_check_interval_seconds)
        if not bool(node["monitoring_enabled"]):
            return {
                "status": "accepted",
                "report_stored": False,
                "monitoring_enabled": False,
                "check_interval_seconds": target_interval,
            }

        db.insert_report(conn, node["id"], payload)
        for alert in evaluate_alerts_for_node(conn, node["id"], config.alerts):
            if alert["created"]:
                send_notification(config.notifications, alert["title"], alert["message"])
        return {
            "status": "accepted",
            "report_stored": True,
            "monitoring_enabled": True,
            "check_interval_seconds": target_interval,
        }

    @app.get("/api/v1/app/summary")
    def get_summary(_app_token=Depends(require_app), conn: Connection = Depends(get_db)) -> dict[str, Any]:
        nodes = [build_node_view(conn, row, config.alerts) for row in db.nodes_with_latest(conn)]
        active_nodes = [node for node in nodes if node["monitoring_enabled"]]
        status_counts: dict[str, int] = {}
        for node in nodes:
            status_counts[node["status"]] = status_counts.get(node["status"], 0) + 1
        total_quota = sum(node["quota_bytes"] or 0 for node in active_nodes)
        total_used = sum(node["period_used_bytes"] or 0 for node in active_nodes)
        return {
            "node_count": len(nodes),
            "active_node_count": len(active_nodes),
            "status_counts": status_counts,
            "total_quota_bytes": total_quota,
            "total_used_bytes": total_used,
            "total_remaining_bytes": max(total_quota - total_used, 0) if total_quota else None,
            "alerts_open": len(db.list_alerts(conn)),
        }

    @app.get("/api/v1/app/nodes")
    def get_nodes(_app_token=Depends(require_app), conn: Connection = Depends(get_db)) -> list[dict[str, Any]]:
        return [build_node_view(conn, row, config.alerts) for row in db.nodes_with_latest(conn)]

    @app.get("/api/v1/app/nodes/{node_id}")
    def get_node(
        node_id: str,
        _app_token=Depends(require_app),
        conn: Connection = Depends(get_db),
    ) -> dict[str, Any]:
        row = db.node_by_id(conn, node_id)
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Node not found")
        node = build_node_view(conn, row, config.alerts)
        history = db.recent_reports(conn, node_id, 30)
        node["history"] = history
        return node

    @app.get("/api/v1/app/alerts")
    def get_alerts(
        include_resolved: bool = False,
        _app_token=Depends(require_app),
        conn: Connection = Depends(get_db),
    ) -> list[dict[str, Any]]:
        return db.list_alerts(conn, include_resolved=include_resolved)

    @app.get("/api/v1/app/settings")
    def get_settings(_app_token=Depends(require_app), conn: Connection = Depends(get_db)) -> dict[str, Any]:
        return {
            "default_check_interval_seconds": db.get_default_check_interval(conn),
            "min_check_interval_seconds": db.MIN_CHECK_INTERVAL_SECONDS,
            "max_check_interval_seconds": db.MAX_CHECK_INTERVAL_SECONDS,
        }

    @app.put("/api/v1/app/settings/check-interval")
    def put_check_interval(
        update: CheckIntervalUpdate,
        _app_token=Depends(require_app),
        conn: Connection = Depends(get_db),
    ) -> dict[str, Any]:
        seconds = db.set_default_check_interval(conn, update.seconds)
        return {
            "default_check_interval_seconds": seconds,
            "min_check_interval_seconds": db.MIN_CHECK_INTERVAL_SECONDS,
            "max_check_interval_seconds": db.MAX_CHECK_INTERVAL_SECONDS,
        }

    @app.patch("/api/v1/app/nodes/{node_id}/settings")
    def patch_node_settings(
        node_id: str,
        update: NodeSettingsUpdate,
        _app_token=Depends(require_app),
        conn: Connection = Depends(get_db),
    ) -> dict[str, Any]:
        override = db._UNSET
        if "check_interval_seconds_override" in update.model_fields_set:
            override = update.check_interval_seconds_override
        updated = db.update_node_settings(
            conn,
            node_id,
            monitoring_enabled=update.monitoring_enabled,
            check_interval_seconds_override=override,
        )
        if not updated:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Node not found")
        if update.monitoring_enabled is False:
            db.resolve_alerts(conn, node_id, set())
        row = db.node_by_id(conn, node_id)
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Node not found")
        return build_node_view(conn, row, config.alerts)

    _mount_web_app(app)
    return app


def app_from_env() -> FastAPI:
    import os

    config_path = os.environ.get("VPSMON_CONTROLLER_CONFIG", "/etc/vpsmonitor/controller.yaml")
    return create_app(config_path)


def _mount_web_app(app: FastAPI) -> None:
    import os

    web_dir = Path(os.environ.get("VPSMON_WEB_DIR", Path(__file__).with_name("web")))
    index_file = web_dir / "index.html"
    if not index_file.exists():
        return

    assets_dir = web_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="web-assets")

    @app.get("/", include_in_schema=False)
    def web_index():
        return FileResponse(index_file)

    @app.get("/{full_path:path}", include_in_schema=False)
    def web_fallback(full_path: str):
        if full_path.startswith("api/") or full_path == "healthz":
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
        candidate = web_dir / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_file)
