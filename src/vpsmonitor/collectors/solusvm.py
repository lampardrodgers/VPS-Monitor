from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

from ..config import resolve_secret
from ..models import Observation
from .base import Collector, ProviderError


class RackNerdCollector(Collector):
    """Read-only RackNerd adapter for the per-VPS SolusVM 1 client API."""

    provider = "racknerd"
    default_url = "https://nerdvm.racknerd.com/api/client/command.php"

    def collect(self) -> list[Observation]:
        entries = self.config.get("instances") or []
        if not isinstance(entries, list) or not entries:
            raise ProviderError("racknerd.instances 未配置")
        base_url = str(self.config.get("base_url") or self.default_url).strip()
        observations: list[Observation] = []
        with self.client(headers={"User-Agent": "curl/8.7.1", "Accept": "*/*"}) as client:
            for index, entry in enumerate(entries, start=1):
                if not isinstance(entry, dict) or entry.get("enabled", True) is False:
                    continue
                key = resolve_secret(
                    entry.get("api_key"), field=f"racknerd.instances[{index}].api_key"
                )
                hash_value = resolve_secret(
                    entry.get("api_hash"), field=f"racknerd.instances[{index}].api_hash"
                )
                auth = {"key": key, "hash": hash_value}
                info = self._call(
                    client,
                    base_url,
                    auth,
                    "info",
                    ipaddr="true",
                    hdd="true",
                    mem="true",
                    bw="true",
                )
                state = self._call(client, base_url, auth, "status")
                observations.append(self._observation(entry, info, state))
        if not observations:
            raise ProviderError("RackNerd 没有启用的 VPS")
        return observations

    @staticmethod
    def _call(
        client: Any,
        base_url: str,
        auth: dict[str, str],
        action: str,
        **options: str,
    ) -> dict[str, str]:
        response = client.post(
            base_url,
            data={**auth, "action": action, **options},
        )
        if response.status_code >= 400:
            raise ProviderError(f"RackNerd {action} 返回 HTTP {response.status_code}")
        payload = _parse_xml_fragment(response.text)
        if payload.get("status", "").casefold() == "error":
            message = payload.get("statusmsg") or "API 调用失败"
            raise ProviderError(f"RackNerd {action} 失败：{message[:200]}")
        return payload

    def _observation(
        self,
        entry: dict[str, Any],
        info: dict[str, str],
        state: dict[str, str],
    ) -> Observation:
        disk_total, disk_used, disk_free, _ = _resource_values(info.get("hdd"))
        memory_total, memory_used, memory_free, _ = _resource_values(info.get("mem"))
        traffic_total, traffic_used, traffic_free, _ = _resource_values(info.get("bw"))
        disk_usage_supported = not (
            disk_total is not None
            and disk_used == 0
            and disk_free == disk_total
        )

        # RackNerd KVM currently returns 0,0,0,0 for memory. Omit unsupported
        # measurements instead of presenting a misleading 0% value.
        metrics = _without_none(
            {
                "disk_total_bytes": disk_total if disk_total and disk_total > 0 else None,
                "disk_used_bytes": (
                    disk_used if disk_total and disk_total > 0 and disk_usage_supported else None
                ),
                "disk_available_bytes": (
                    disk_free if disk_total and disk_total > 0 and disk_usage_supported else None
                ),
                "memory_total_bytes": memory_total if memory_total and memory_total > 0 else None,
                "memory_used_bytes": memory_used if memory_total and memory_total > 0 else None,
                "memory_available_bytes": memory_free if memory_total and memory_total > 0 else None,
            }
        )
        quota = _without_none(
            {
                "traffic_total_bytes": (
                    traffic_total if traffic_total and traffic_total > 0 else None
                ),
                "traffic_used_bytes": (
                    traffic_used if traffic_total and traffic_total > 0 else None
                ),
                "traffic_remaining_bytes": (
                    traffic_free if traffic_total and traffic_total > 0 else None
                ),
            }
        )
        ip = info.get("ipaddr") or info.get("ipaddress")
        hostname = info.get("hostname")
        instance_key = str(entry.get("instance_id") or ip or hostname or "racknerd")
        status = state.get("statusmsg") or "unknown"
        return Observation(
            provider=self.provider,
            instance_key=instance_key,
            display_name=str(entry.get("name") or hostname or instance_key),
            status=status.casefold(),
            metrics=metrics,
            quota=quota,
            metadata=_without_none(
                {
                    "ip": ip,
                    "hostname": hostname,
                    "panel": "SolusVM 1",
                    "resource_usage_source": "solusvm",
                }
            ),
            raw={"info": info, "status": state},
        )


def _parse_xml_fragment(value: str) -> dict[str, str]:
    try:
        root = ET.fromstring(f"<response>{value}</response>")
    except ET.ParseError as exc:
        raise ProviderError("RackNerd 返回的不是有效 SolusVM XML") from exc
    return {node.tag: node.text or "" for node in root}


def _resource_values(value: str | None) -> tuple[int | None, int | None, int | None, float | None]:
    if not value:
        return None, None, None, None
    parts = [part.strip() for part in value.split(",")]
    if len(parts) < 4:
        return None, None, None, None
    try:
        return int(float(parts[0])), int(float(parts[1])), int(float(parts[2])), float(parts[3])
    except ValueError:
        return None, None, None, None


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}
