from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import httpx

from ..models import Observation


class ProviderError(RuntimeError):
    pass


class Collector(ABC):
    provider: str

    def __init__(self, config: dict[str, Any], timeout: float):
        self.config = config
        override = config.get("timeout_seconds") if isinstance(config, dict) else None
        self.timeout = max(1.0, float(override)) if override is not None else timeout

    @abstractmethod
    def collect(self) -> list[Observation]:
        raise NotImplementedError

    def client(self, **kwargs: Any) -> httpx.Client:
        timeout = kwargs.pop("timeout", self.timeout)
        if "transport" not in kwargs:
            verify = kwargs.pop("verify", True)
            kwargs["transport"] = httpx.HTTPTransport(verify=verify, retries=2)
        return httpx.Client(timeout=timeout, follow_redirects=True, **kwargs)


def response_json(response: httpx.Response) -> Any:
    if response.status_code >= 400:
        raise ProviderError(f"HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise ProviderError("供应商返回的不是 JSON") from exc
