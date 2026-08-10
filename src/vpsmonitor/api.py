from __future__ import annotations

import ipaddress
import json
import os
import sqlite3
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import __version__
from .collectors import AliyunSwasCollector
from .collectors.base import ProviderError
from .config import ConfigError, default_config_path, load_config, secret_env_path


class ServiceInfo(BaseModel):
    name: str
    version: str
    documentation: str
    openapi: str


class HealthResponse(BaseModel):
    status: str
    database: str
    latest_observation_at: str | None = None


class ProviderStatus(BaseModel):
    provider: str
    ok: bool
    instance_count: int
    last_collected_at: str
    last_error: str | None = None


class ProviderListResponse(BaseModel):
    items: list[ProviderStatus]


class InstanceObservation(BaseModel):
    provider: str
    instance_key: str
    display_name: str
    observed_at: str
    status: str | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    quota: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class InstanceListResponse(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[InstanceObservation]


class HistoryPoint(BaseModel):
    observed_at: str
    status: str | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    quota: dict[str, Any] = Field(default_factory=dict)


class InstanceHistoryResponse(BaseModel):
    provider: str
    instance_key: str
    hours: int
    points: list[HistoryPoint]


class LiveQueryResponse(BaseModel):
    provider: str
    requested_at: str
    completed_at: str
    duration_ms: int
    total: int
    items: list[InstanceObservation]


class SummaryResponse(BaseModel):
    generated_at: str
    providers_total: int
    providers_ok: int
    instances_total: int
    instances_online: int
    instances_unlimited_traffic: int
    traffic_used_bytes: int
    traffic_total_bytes: int


def create_app(config_path: str | Path | None = None) -> FastAPI:
    selected_config = Path(config_path).expanduser() if config_path else default_config_path()
    load_dotenv(secret_env_path(), override=False)
    live_refresh_lock = threading.Lock()
    live_cache: LiveQueryResponse | None = None
    live_cache_expires_at = 0.0
    live_min_interval = _environment_seconds(
        "VPSMON_LIVE_MIN_INTERVAL_SECONDS",
        default=30,
        minimum=30,
    )
    application = FastAPI(
        title="VPS Monitor Read API",
        summary="统一读取多供应商 VPS 状态、资源指标和流量历史",
        description=(
            "只读 API。响应不会包含供应商 Token、密码或原始供应商响应。"
            "生产部署仅监听 127.0.0.1，并通过 SSH 隧道访问。"
        ),
        version=__version__,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        openapi_tags=[
            {"name": "system", "description": "服务状态与入口"},
            {"name": "providers", "description": "供应商采集状态"},
            {"name": "instances", "description": "实例最新数据与历史曲线"},
            {"name": "live", "description": "按服务端最小间隔查询供应商 API"},
            {"name": "summary", "description": "总览统计"},
        ],
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=False,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["Accept", "Content-Type", "Cache-Control", "Pragma"],
        max_age=3600,
    )

    def database_path() -> Path:
        config = load_config(selected_config)
        return config.database_path

    @application.get("/", response_model=ServiceInfo, tags=["system"])
    def service_info() -> ServiceInfo:
        return ServiceInfo(
            name="VPS Monitor Read API",
            version=__version__,
            documentation="/docs",
            openapi="/openapi.json",
        )

    @application.get("/health", response_model=HealthResponse, tags=["system"])
    def health() -> HealthResponse:
        path = database_path()
        try:
            with _connect(path) as connection:
                row = connection.execute(
                    "SELECT MAX(observed_at) AS latest FROM observations"
                ).fetchone()
        except (OSError, sqlite3.Error):
            raise HTTPException(status_code=503, detail="监控数据库不可用") from None
        return HealthResponse(
            status="ok",
            database="ok",
            latest_observation_at=row["latest"] if row else None,
        )

    @application.get(
        "/api/v1/providers",
        response_model=ProviderListResponse,
        tags=["providers"],
    )
    def providers() -> ProviderListResponse:
        with _connect_or_503(database_path()) as connection:
            counts = {
                row["provider"]: row["count"]
                for row in connection.execute(
                    """
                    SELECT provider, COUNT(*) AS count FROM (
                        SELECT provider, instance_key, MAX(id)
                        FROM observations GROUP BY provider, instance_key
                    ) GROUP BY provider
                    """
                ).fetchall()
            }
            rows = connection.execute(
                """
                SELECT r.provider, r.ok, r.finished_at, r.error
                FROM collector_runs r
                JOIN (
                    SELECT provider, MAX(id) AS max_id
                    FROM collector_runs GROUP BY provider
                ) latest ON latest.max_id = r.id
                ORDER BY r.provider
                """
            ).fetchall()
        return ProviderListResponse(
            items=[
                ProviderStatus(
                    provider=row["provider"],
                    ok=bool(row["ok"]),
                    instance_count=int(counts.get(row["provider"], 0)),
                    last_collected_at=row["finished_at"],
                    last_error=row["error"],
                )
                for row in rows
            ]
        )

    @application.get(
        "/api/v1/instances",
        response_model=InstanceListResponse,
        tags=["instances"],
    )
    def instances(
        provider: str | None = Query(default=None, description="按供应商标识过滤"),
        status: str | None = Query(default=None, description="按实例状态过滤，不区分大小写"),
        search: str | None = Query(default=None, description="搜索实例名称或实例标识"),
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=100, ge=1, le=500),
    ) -> InstanceListResponse:
        rows = _latest_rows(database_path())
        if provider:
            rows = [row for row in rows if row["provider"] == provider]
        if status:
            wanted = status.casefold()
            rows = [row for row in rows if str(row["status"] or "").casefold() == wanted]
        if search:
            needle = search.casefold()
            rows = [
                row
                for row in rows
                if needle in row["display_name"].casefold()
                or needle in row["instance_key"].casefold()
            ]
        total = len(rows)
        selected = rows[offset : offset + limit]
        return InstanceListResponse(
            total=total,
            offset=offset,
            limit=limit,
            items=[InstanceObservation(**row) for row in selected],
        )

    @application.get(
        "/api/v1/instances/{provider}/{instance_key}",
        response_model=InstanceObservation,
        tags=["instances"],
    )
    def instance(provider: str, instance_key: str) -> InstanceObservation:
        with _connect_or_503(database_path()) as connection:
            row = connection.execute(
                """
                SELECT provider, instance_key, display_name, observed_at, status,
                       metrics_json, quota_json, metadata_json
                FROM observations
                WHERE provider = ? AND instance_key = ?
                ORDER BY id DESC LIMIT 1
                """,
                (provider, instance_key),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="实例不存在")
        return InstanceObservation(**_decode_api_row(row))

    @application.get(
        "/api/v1/instances/{provider}/{instance_key}/history",
        response_model=InstanceHistoryResponse,
        tags=["instances"],
    )
    def instance_history(
        provider: str,
        instance_key: str,
        hours: int = Query(default=24, ge=1, le=8760),
        limit: int = Query(default=1000, ge=1, le=10000),
    ) -> InstanceHistoryResponse:
        since = (datetime.now(UTC) - timedelta(hours=hours)).isoformat(timespec="seconds")
        with _connect_or_503(database_path()) as connection:
            exists = connection.execute(
                "SELECT 1 FROM observations WHERE provider = ? AND instance_key = ? LIMIT 1",
                (provider, instance_key),
            ).fetchone()
            if exists is None:
                raise HTTPException(status_code=404, detail="实例不存在")
            rows = connection.execute(
                """
                SELECT observed_at, status, metrics_json, quota_json
                FROM (
                    SELECT id, observed_at, status, metrics_json, quota_json
                    FROM observations
                    WHERE provider = ? AND instance_key = ? AND observed_at >= ?
                    ORDER BY id DESC LIMIT ?
                ) ORDER BY id ASC
                """,
                (provider, instance_key, since, limit),
            ).fetchall()
        return InstanceHistoryResponse(
            provider=provider,
            instance_key=instance_key,
            hours=hours,
            points=[
                HistoryPoint(
                    observed_at=row["observed_at"],
                    status=row["status"],
                    metrics=json.loads(row["metrics_json"]),
                    quota=json.loads(row["quota_json"]),
                )
                for row in rows
            ],
        )

    @application.get(
        "/api/v1/live/aliyun_swas",
        response_model=LiveQueryResponse,
        tags=["live"],
        summary="立即查询一次阿里云轻量服务器",
        description=(
            "不读取监控数据库缓存。服务端会短暂复用最近一次实时结果并合并并发请求；"
            "阿里云 AccessKey 只保留在服务端。"
        ),
    )
    def live_aliyun_swas(response: Response) -> LiveQueryResponse:
        nonlocal live_cache, live_cache_expires_at
        response.headers["Cache-Control"] = "no-store"
        with live_refresh_lock:
            now = time.monotonic()
            if live_cache is not None and now < live_cache_expires_at:
                response.headers["X-VPSMonitor-Live-Cache"] = "hit"
                return live_cache

            requested_at = datetime.now(UTC).isoformat(timespec="seconds")
            started = time.monotonic()
            config = load_config(selected_config)
            provider_config = config.providers.get("aliyun_swas")
            if not isinstance(provider_config, dict) or provider_config.get("enabled") is False:
                raise HTTPException(status_code=503, detail="阿里云实时查询未配置")
            try:
                observations = AliyunSwasCollector(
                    provider_config, config.timeout_seconds
                ).collect()
            except (ConfigError, ProviderError) as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"阿里云实时查询失败：{str(exc)[:300]}",
                ) from None
            except Exception as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"阿里云实时查询失败：{type(exc).__name__}",
                ) from None
            completed_at = datetime.now(UTC).isoformat(timespec="seconds")
            live_cache = LiveQueryResponse(
                provider="aliyun_swas",
                requested_at=requested_at,
                completed_at=completed_at,
                duration_ms=max(0, round((time.monotonic() - started) * 1000)),
                total=len(observations),
                items=[
                    InstanceObservation(
                        provider=item.provider,
                        instance_key=item.instance_key,
                        display_name=item.display_name,
                        observed_at=item.observed_at,
                        status=item.status,
                        metrics=item.metrics,
                        quota=item.quota,
                        metadata=item.metadata,
                    )
                    for item in observations
                ],
            )
            live_cache_expires_at = time.monotonic() + live_min_interval
            response.headers["X-VPSMonitor-Live-Cache"] = "miss"
            return live_cache

    @application.get(
        "/api/v1/summary",
        response_model=SummaryResponse,
        tags=["summary"],
    )
    def summary() -> SummaryResponse:
        rows = _latest_rows(database_path())
        with _connect_or_503(database_path()) as connection:
            runs = connection.execute(
                """
                SELECT r.ok FROM collector_runs r
                JOIN (
                    SELECT provider, MAX(id) AS max_id
                    FROM collector_runs GROUP BY provider
                ) latest ON latest.max_id = r.id
                """
            ).fetchall()
        return SummaryResponse(
            generated_at=datetime.now(UTC).isoformat(timespec="seconds"),
            providers_total=len(runs),
            providers_ok=sum(1 for row in runs if row["ok"]),
            instances_total=len(rows),
            instances_online=sum(1 for row in rows if _is_online(row["status"])),
            instances_unlimited_traffic=sum(
                1 for row in rows if row["quota"].get("traffic_unlimited") is True
            ),
            traffic_used_bytes=sum(
                _integer(row["quota"].get("traffic_used_bytes")) for row in rows
            ),
            traffic_total_bytes=sum(
                _integer(row["quota"].get("traffic_total_bytes")) for row in rows
            ),
        )

    return application


def _connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _connect_or_503(path: Path) -> sqlite3.Connection:
    try:
        return _connect(path)
    except (OSError, sqlite3.Error):
        raise HTTPException(status_code=503, detail="监控数据库不可用") from None


def _latest_rows(path: Path) -> list[dict[str, Any]]:
    with _connect_or_503(path) as connection:
        rows = connection.execute(
            """
            SELECT o.provider, o.instance_key, o.display_name, o.observed_at,
                   o.status, o.metrics_json, o.quota_json, o.metadata_json
            FROM observations o
            JOIN (
                SELECT provider, instance_key, MAX(id) AS max_id
                FROM observations GROUP BY provider, instance_key
            ) latest ON latest.max_id = o.id
            ORDER BY o.provider, o.display_name
            """
        ).fetchall()
    return [_decode_api_row(row) for row in rows]


def _decode_api_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "provider": row["provider"],
        "instance_key": row["instance_key"],
        "display_name": row["display_name"],
        "observed_at": row["observed_at"],
        "status": row["status"],
        "metrics": json.loads(row["metrics_json"]),
        "quota": json.loads(row["quota_json"]),
        "metadata": json.loads(row["metadata_json"]),
    }


def _is_online(status: Any) -> bool:
    return str(status or "").casefold() in {"running", "ready", "online", "1"}


def _integer(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return max(0, int(value))


def _environment_seconds(name: str, *, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _is_loopback_host(host: str) -> bool:
    normalized = host.strip().removeprefix("[").removesuffix("]")
    if normalized.casefold() == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


app = create_app()


def run() -> None:
    import uvicorn

    host = os.getenv("VPSMON_API_HOST", "127.0.0.1")
    if not _is_loopback_host(host):
        raise RuntimeError(
            "VPS Monitor API 只允许回环监听；远程访问请使用 SSH 隧道或受认证的反向代理"
        )
    uvicorn.run(
        "vpsmonitor.api:app",
        host=host,
        port=int(os.getenv("VPSMON_API_PORT", "8787")),
        access_log=False,
    )
