from __future__ import annotations

import time
from collections.abc import Iterable
from typing import Any

from .collectors import (
    AliyunSwasCollector,
    BandwagonCollector,
    PanstarCollector,
    VirtFusionCollector,
    VirtualizorCollector,
)
from .collectors.base import Collector, ProviderError
from .config import AppConfig, ConfigError
from .db import Database
from .models import CollectorResult, utc_now


COLLECTORS: dict[str, type[Collector]] = {
    "bandwagon": BandwagonCollector,
    "aliyun_swas": AliyunSwasCollector,
    "panstar": PanstarCollector,
    "greencloud": VirtFusionCollector,
    "dedione": VirtualizorCollector,
}


def enabled_provider_names(config: AppConfig) -> list[str]:
    return [
        name
        for name, value in config.providers.items()
        if name in COLLECTORS
        and isinstance(value, dict)
        and value.get("enabled", True) is not False
    ]


def collect_once(
    config: AppConfig,
    database: Database,
    selected: Iterable[str] | None = None,
) -> list[CollectorResult]:
    selected_set = set(selected or [])
    names = enabled_provider_names(config)
    if selected_set:
        unknown = selected_set - set(COLLECTORS)
        if unknown:
            raise ConfigError(f"未知供应商：{', '.join(sorted(unknown))}")
        names = [name for name in names if name in selected_set]
    results: list[CollectorResult] = []
    for name in names:
        started_at = utc_now()
        try:
            collector = COLLECTORS[name](config.providers[name], config.timeout_seconds)
            observations = collector.collect()
            result = CollectorResult(
                provider=name,
                started_at=started_at,
                finished_at=utc_now(),
                observations=observations,
            )
        except Exception as exc:
            # Avoid rendering exception strings: HTTP errors often contain URLs
            # whose query parameters include provider API credentials.
            result = CollectorResult(
                provider=name,
                started_at=started_at,
                finished_at=utc_now(),
                error=_safe_error(exc),
            )
        database.save_result(result)
        results.append(result)
    return results


def run_forever(
    config: AppConfig,
    database: Database,
    selected: Iterable[str] | None = None,
) -> None:
    while True:
        started = time.monotonic()
        results = collect_once(config, database, selected)
        for result in results:
            state = "ok" if result.ok else "error"
            print(f"{result.finished_at} {result.provider}: {state} ({len(result.observations)})", flush=True)
        elapsed = time.monotonic() - started
        time.sleep(max(1, config.poll_interval_seconds - elapsed))


def _safe_error(exc: Exception) -> str:
    if isinstance(exc, ProviderError):
        return str(exc)[:500]
    if isinstance(exc, (ConfigError, RuntimeError)):
        message = str(exc)
        if "http" not in message.lower() and "api_key" not in message.lower():
            return message[:500]
    return type(exc).__name__
