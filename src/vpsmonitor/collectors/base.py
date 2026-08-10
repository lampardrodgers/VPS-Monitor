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
        self.timeout = timeout

    @abstractmethod
    def collect(self) -> list[Observation]:
        raise NotImplementedError

    def client(self, **kwargs: Any) -> httpx.Client:
        if "transport" not in kwargs:
            verify = kwargs.pop("verify", True)
            kwargs["transport"] = httpx.HTTPTransport(verify=verify, retries=2)
        return httpx.Client(timeout=self.timeout, follow_redirects=True, **kwargs)


def response_json(response: httpx.Response) -> Any:
    if response.status_code >= 400:
        raise ProviderError(f"HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise ProviderError("供应商返回的不是 JSON") from exc
