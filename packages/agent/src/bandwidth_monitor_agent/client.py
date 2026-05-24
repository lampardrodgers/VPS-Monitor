from __future__ import annotations

from urllib.error import HTTPError
from urllib.request import Request, urlopen
import json

from .config import AgentConfig


def post_report(config: AgentConfig, report: dict) -> dict:
    url = f"{config.controller_url}/api/v1/agent/report"
    body = json.dumps(report).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {config.node_token}",
            "Content-Type": "application/json",
            "User-Agent": "vpsmon-agent/0.1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=config.timeout_seconds) as response:
            data = response.read().decode("utf-8")
            return json.loads(data) if data else {"status": response.status}
    except HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"controller returned HTTP {exc.code}: {error_body}") from exc
