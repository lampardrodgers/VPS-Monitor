from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from typing import Any


_KEY_NORMALIZER = re.compile(r"[^a-z0-9]")


def normalized_key(value: str) -> str:
    return _KEY_NORMALIZER.sub("", value.lower())


def deep_find(value: Any, candidate_keys: Iterable[str]) -> Any:
    wanted = {normalized_key(key) for key in candidate_keys}
    queue = [value]
    while queue:
        current = queue.pop(0)
        if isinstance(current, Mapping):
            for key, child in current.items():
                if normalized_key(str(key)) in wanted and child is not None:
                    return child
            queue.extend(current.values())
        elif isinstance(current, list):
            queue.extend(current)
    return None


def first_mapping_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if not isinstance(value, dict):
        return []
    for key in ("items", "list", "records", "content", "instances", "servers", "data"):
        child = value.get(key)
        if isinstance(child, list):
            return [item for item in child if isinstance(item, dict)]
        if isinstance(child, dict):
            nested = first_mapping_list(child)
            if nested:
                return nested
    # Virtualizor often returns a mapping keyed by VPS id.
    if value and all(isinstance(item, dict) for item in value.values()):
        return list(value.values())
    return []


def as_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "")
        match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
        if match:
            try:
                return float(match.group(0))
            except ValueError:
                pass
    return None


def as_int(value: Any) -> int | None:
    number = as_number(value)
    return int(number) if number is not None else None


def bytes_from(value: Any, default_unit: str = "bytes") -> int | None:
    number = as_number(value)
    if number is None:
        return None
    text = str(value).lower()
    unit = default_unit.lower()
    for marker, candidate in (
        ("tib", "tib"), ("tb", "tb"), ("gib", "gib"), ("gb", "gb"),
        ("mib", "mib"), ("mb", "mb"), ("kib", "kib"), ("kb", "kb"),
    ):
        if marker in text:
            unit = candidate
            break
    multipliers = {
        "bytes": 1,
        "b": 1,
        "kb": 1000,
        "kib": 1024,
        "mb": 1000**2,
        "mib": 1024**2,
        "gb": 1000**3,
        "gib": 1024**3,
        "tb": 1000**4,
        "tib": 1024**4,
    }
    return int(number * multipliers.get(unit, 1))


def epoch_to_iso(value: Any) -> str | None:
    number = as_number(value)
    if number is None:
        return None
    if number > 10_000_000_000:
        number /= 1000
    try:
        return datetime.fromtimestamp(number, tz=UTC).isoformat(timespec="seconds")
    except (OverflowError, OSError, ValueError):
        return None


def json_default(value: Any) -> Any:
    if hasattr(value, "to_map"):
        return value.to_map()
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=json_default)


def redact_sensitive(value: Any) -> Any:
    """Return a JSON-compatible copy with credentials removed by key name."""
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for key, child in value.items():
            normalized = normalized_key(str(key))
            if _is_sensitive_key(normalized):
                result[str(key)] = "[REDACTED]"
            else:
                result[str(key)] = redact_sensitive(child)
        return result
    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]
    return value


def _is_sensitive_key(key: str) -> bool:
    return (
        "password" in key
        or "passwd" in key
        or key in {"apikey", "apipass", "token", "secret", "accesskeysecret"}
        or key.endswith("secret")
    )
