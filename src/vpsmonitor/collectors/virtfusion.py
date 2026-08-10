from __future__ import annotations

from typing import Any

from ..config import resolve_secret
from ..models import Observation
from ..util import as_number, bytes_from, deep_find, first_mapping_list
from .base import Collector, ProviderError, response_json


class VirtFusionCollector(Collector):
    """VirtFusion 6.1+ segregated end-user API collector.

    GreenCloud exposes VirtFusion's segregated API at /api/server.  Paths remain
    configurable for providers that customise the public prefix; raw responses
    are retained for forward compatibility.
    """

    provider = "greencloud"

    def collect(self) -> list[Observation]:
        base_url = str(self.config.get("base_url") or "https://cp.green.cloud").rstrip("/")
        token = resolve_secret(self.config.get("token"), field="greencloud.token")
        servers_path = str(self.config.get("servers_path") or "/api/server")
        detail_path = str(self.config.get("detail_path") or "/api/server/{id}?state=true")
        state_path = self.config.get("state_path")
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        with self.client(headers=headers) as client:
            list_payload = self._get(client, base_url + servers_path)
            instances = first_mapping_list(list_payload.get("data", list_payload))
            if not instances:
                raise ProviderError("VirtFusion API 没有返回服务器")
            observations: list[Observation] = []
            for item in instances:
                server_id = deep_find(item, ("id", "server_id", "serverId", "uuid"))
                if server_id is None:
                    continue
                raw: dict[str, Any] = {"list_item": item}
                raw["detail"] = self._get(client, base_url + detail_path.format(id=server_id))
                if state_path:
                    raw["state"] = self._get(client, base_url + str(state_path).format(id=server_id))
                observations.append(self._observation(str(server_id), raw))
            return observations

    @staticmethod
    def _get(client: Any, url: str) -> dict[str, Any]:
        response = client.get(url)
        if response.status_code == 403 and response.headers.get("cf-mitigated") == "challenge":
            raise ProviderError("GreenCloud API 被 Cloudflare JavaScript Challenge 拦截")
        payload = response_json(response)
        if not isinstance(payload, dict):
            raise ProviderError("VirtFusion 返回格式异常")
        return payload

    def _observation(self, server_id: str, raw: dict[str, Any]) -> Observation:
        detail = _data_mapping(raw.get("detail"))
        list_item = _data_mapping(raw.get("list_item"))
        state = detail.get("state") if isinstance(detail.get("state"), dict) else {}
        state_network = state.get("network") if isinstance(state.get("network"), dict) else {}
        detail_network = detail.get("network") if isinstance(detail.get("network"), dict) else {}
        state_primary = state_network.get("primary") if isinstance(state_network.get("primary"), dict) else {}
        detail_primary = detail_network.get("primary") if isinstance(detail_network.get("primary"), dict) else {}
        traffic = state_primary.get("traffic") if isinstance(state_primary.get("traffic"), dict) else {}

        # The top-level ``cpu`` value is the provisioned core count.  Runtime
        # CPU lives below ``data.state`` and must take precedence.
        cpu_percent = as_number(_first_value(state, ("cpu", "cpu_usage", "cpuUsage")))
        memory_total = bytes_from(
            _first_value(detail, ("memory_total", "memoryTotal", "memory", "memtotal")), "bytes"
        )
        memory_available = bytes_from(
            _first_value(
                state,
                ("memory_available", "memoryAvailable", "available_memory", "memavailable"),
            ),
            "bytes",
        )
        memory_used = None
        explicit_memory_used = bytes_from(
            _first_value(state, ("memory_used", "memoryUsed", "memory", "used_memory", "memused")),
            "bytes",
        )
        if explicit_memory_used is not None:
            memory_used = explicit_memory_used
        elif memory_total is not None and memory_available is not None:
            memory_used = max(0, memory_total - memory_available)
        metrics = _without_none(
            {
                "cpu_percent": cpu_percent,
                "memory_used_bytes": memory_used,
                "memory_available_bytes": memory_available,
                "memory_total_bytes": memory_total,
                "disk_used_bytes": bytes_from(
                    _first_value(state, ("disk_used", "diskUsed", "used_disk"))
                ),
                "disk_total_bytes": bytes_from(
                    _first_value(detail, ("disk_total", "diskTotal", "disk", "storage"))
                ),
                "network_in_bps": as_number(
                    _first_value(state_primary, ("rx_rate", "rxRate", "inbound_speed"))
                ),
                "network_out_bps": as_number(
                    _first_value(state_primary, ("tx_rate", "txRate", "outbound_speed"))
                ),
            }
        )
        # With ``state=true`` VirtFusion reports period traffic at
        # data.state.network.primary.traffic and allowance at
        # data.network.primary.limit.
        traffic_used = bytes_from(_first_value(traffic, ("total", "used", "traffic_used")))
        traffic_total = bytes_from(_first_value(detail_primary, ("limit", "traffic_limit", "allowance")))
        quota = _without_none(
            {
                "traffic_used_bytes": traffic_used,
                "traffic_total_bytes": traffic_total,
                "traffic_remaining_bytes": (
                    max(0, traffic_total - traffic_used)
                    if traffic_total is not None and traffic_used is not None
                    else None
                ),
                "traffic_rx_bytes": bytes_from(_first_value(traffic, ("rx", "received"))),
                "traffic_tx_bytes": bytes_from(_first_value(traffic, ("tx", "transmitted"))),
                "traffic_period_start": _first_value(
                    detail_primary, ("period_start", "start", "traffic_start")
                ),
                "traffic_period_end": _first_value(
                    detail_primary, ("period_end", "end", "traffic_end")
                ),
            }
        )
        display_name = _first_value(detail, ("name", "hostname")) or _first_value(
            list_item, ("name", "hostname")
        )
        status = _first_value(state, ("status", "state")) or _first_value(detail, ("status",))
        metadata = _without_none(
            {
                "server_id": server_id,
                "uuid": _first_value(detail, ("uuid",)),
                "ip": _first_value(detail, ("ipv4", "ip")),
                "created_at": _first_value(detail, ("created_at", "created")),
                "os": _first_value(detail, ("os_name", "osName", "os")),
            }
        )
        return Observation(
            provider=self.provider,
            instance_key=server_id,
            display_name=str(display_name or f"GreenCloud-{server_id}"),
            status=str(status or "unknown"),
            metrics=metrics,
            quota=quota,
            metadata=metadata,
            raw=raw,
        )


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def _data_mapping(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    data = value.get("data")
    return data if isinstance(data, dict) else value


def _first_value(value: Any, keys: tuple[str, ...]) -> Any:
    if not isinstance(value, dict):
        return None
    for key in keys:
        item = value.get(key)
        if item is not None:
            return item
    return deep_find(value, keys)
