from __future__ import annotations

from typing import Any

from ..config import resolve_secret
from ..models import Observation
from ..util import as_number, bytes_from, deep_find, epoch_to_iso, first_mapping_list
from .base import Collector, ProviderError, response_json


class PanstarCollector(Collector):
    provider = "panstar"

    def collect(self) -> list[Observation]:
        base_url = str(self.config.get("base_url") or "https://panstar.ai").rstrip("/")
        token = resolve_secret(self.config.get("token"), field="panstar.token")
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        with self.client(headers=headers) as client:
            list_payload = self._get(client, f"{base_url}/api/key/u0/vi/list")
            instances = first_mapping_list(list_payload.get("data", list_payload))
            if not instances:
                return [
                    Observation(
                        provider=self.provider,
                        instance_key="account",
                        display_name="PanstarCloud",
                        status="unknown",
                        raw={"instance_list": list_payload},
                    )
                ]
            observations: list[Observation] = []
            for instance in instances:
                instance_id = deep_find(instance, ("id", "instance_id", "instanceId", "vi_id", "viId"))
                if instance_id is None:
                    continue
                detail = self._get(client, f"{base_url}/api/key/u0/vi/{instance_id}")
                observations.append(self._observation(str(instance_id), instance, detail))
            return observations

    @staticmethod
    def _get(client: Any, url: str) -> dict[str, Any]:
        payload = response_json(client.get(url))
        if not isinstance(payload, dict):
            raise ProviderError("Panstar 返回格式异常")
        if payload.get("code") not in (None, 0, "0"):
            raise ProviderError("Panstar API 调用失败")
        return payload

    def _observation(
        self,
        instance_id: str,
        summary: dict[str, Any],
        detail_response: dict[str, Any],
    ) -> Observation:
        detail = detail_response.get("data", detail_response)
        combined = {"summary": summary, "detail": detail}
        memory_total = bytes_from(detail.get("memory"), "mib")
        memory_used = bytes_from(deep_find(combined, ("memory_used", "memoryUsed", "used_memory")))
        disk_total = bytes_from(detail.get("disk"), "gib")
        disk_used = bytes_from(deep_find(combined, ("disk_used", "diskUsed", "used_disk")))
        metrics = _without_none(
            {
                "cpu_percent": as_number(deep_find(combined, ("cpu_usage", "cpuUsage", "cpu_percent"))),
                "memory_used_bytes": memory_used,
                "memory_total_bytes": memory_total,
                "disk_used_bytes": disk_used,
                "disk_total_bytes": disk_total,
                "network_in_bps": as_number(deep_find(combined, ("network_in", "networkIn", "download_speed"))),
                "network_out_bps": as_number(deep_find(combined, ("network_out", "networkOut", "upload_speed"))),
            }
        )
        traffic_in = bytes_from(detail.get("useTrafficIn"))
        traffic_out = bytes_from(detail.get("useTrafficOut"))
        traffic_used = (
            traffic_in + traffic_out
            if traffic_in is not None and traffic_out is not None
            else traffic_in or traffic_out
        )
        traffic_total = bytes_from(detail.get("traffic"), "gib")
        quota = _without_none(
            {
                "traffic_used_bytes": traffic_used,
                "traffic_total_bytes": traffic_total,
                "traffic_in_bytes": traffic_in,
                "traffic_out_bytes": traffic_out,
                "traffic_remaining_bytes": (
                    max(0, traffic_total - traffic_used)
                    if traffic_total is not None and traffic_used is not None
                    else None
                ),
                "traffic_reset_at": deep_find(combined, ("traffic_reset_at", "trafficResetAt", "reset_time")),
            }
        )
        name = deep_find(combined, ("name", "instance_name", "instanceName", "hostname"))
        status = detail.get("deliveryStatus") or detail.get("deliveryPhase")
        metadata = _without_none(
            {
                "cpu_cores": as_number(detail.get("cpu")),
                "region": deep_find(combined, ("region", "region_name", "regionName")),
                "plan": deep_find(combined, ("plan", "plan_name", "planName", "package_name")),
                "ip": deep_find(combined, ("ipv4", "ip", "ip_address", "ipAddress")),
                "expires_at": epoch_to_iso(detail.get("expireTime")),
                "traffic_updated_at": epoch_to_iso(detail.get("lastTrafficUpdateTime")),
                "os": detail.get("osType"),
            }
        )
        return Observation(
            provider=self.provider,
            instance_key=instance_id,
            display_name=str(name or f"Panstar-{instance_id}"),
            status=str(status or "unknown"),
            metrics=metrics,
            quota=quota,
            metadata=metadata,
            raw={"list_item": summary, "detail": detail_response},
        )


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}
