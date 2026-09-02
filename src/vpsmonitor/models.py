from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@dataclass(slots=True)
class Observation:
    provider: str
    instance_key: str
    display_name: str
    observed_at: str = field(default_factory=utc_now)
    status: str | None = None
    metrics: dict[str, Any] = field(default_factory=dict)
    quota: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class CollectorResult:
    provider: str
    started_at: str
    finished_at: str
    observations: list[Observation] = field(default_factory=list)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None
