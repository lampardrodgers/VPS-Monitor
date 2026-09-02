from __future__ import annotations

from typing import Any

from ..config import resolve_secret
from ..models import Observation
from ..util import as_number, bytes_from, epoch_to_iso
from .base import Collector, ProviderError, response_json


class BandwagonCollector(Collector):
    provider = "bandwagon"
    api_base = "https://api.64clouds.com/v1"

    def collect(self) -> list[Observation]:
        entries = self.config.get("instances") or []
        if not isinstance(entries, list) or not entries:
            raise ProviderError("bandwagon.instances 未配置")
        observations: list[Observation] = []
        with self.client() as client:
            for index, entry in enumerate(entries):
                if entry.get("enabled", True) is False:
                    continue
                veid = str(entry.get("veid") or "").strip()
                if not veid:
                    raise ProviderError(f"bandwagon.instances[{index}].veid 未配置")
                api_key = resolve_secret(entry.get("api_key"), field=f"bandwagon[{veid}].api_key")
                params = {"veid": veid, "api_key": api_key}
                service = self._call(client, "getServiceInfo", params)
                live = self._call(client, "getLiveServiceInfo", params)
                observations.append(self._observation(entry, veid, service, live))
        return observations

    def _call(self, client: Any, action: str, params: dict[str, str]) -> dict[str, Any]:
        payload = response_json(client.get(f"{self.api_base}/{action}", params=params))
        if not isinstance(payload, dict):
            raise ProviderError(f"KiwiVM {action} 返回格式异常")
        error = payload.get("error")
        if error not in (None, 0, "0", False, ""):
            raise ProviderError(f"KiwiVM {action} 调用失败")
        return payload

    def _observation(
        self,
        entry: dict[str, Any],
        veid: str,
        service: dict[str, Any],
        live: dict[str, Any],
    ) -> Observation:
        ram_total = bytes_from(service.get("plan_ram"))
        mem_available = bytes_from(live.get("mem_available_kb"), "kib")
        memory_used = None
        if ram_total is not None and mem_available is not None:
            memory_used = max(0, ram_total - mem_available)

        metrics = _without_none(
            {
                "cpu_percent": as_number(live.get("cpu_usage")),
                "memory_used_bytes": memory_used,
                "memory_available_bytes": mem_available,
                "memory_total_bytes": ram_total,
                "disk_used_bytes": bytes_from(live.get("disk_usage_bytes")),
                "disk_total_bytes": bytes_from(service.get("plan_disk")),
                "load_average": live.get("load_average"),
            }
        )
        traffic_used = bytes_from(live.get("data_counter") or service.get("data_counter"))
        traffic_total = bytes_from(service.get("plan_monthly_data"))
        quota = _without_none(
            {
                "traffic_used_bytes": traffic_used,
                "traffic_total_bytes": traffic_total,
                "traffic_remaining_bytes": (
                    max(0, traffic_total - traffic_used)
                    if traffic_total is not None and traffic_used is not None
                    else None
                ),
                "traffic_reset_at": epoch_to_iso(service.get("data_next_reset")),
            }
        )
        display_name = str(entry.get("name") or live.get("hostname") or service.get("hostname") or veid)
        metadata = _without_none(
            {
                "veid": veid,
                "plan": service.get("plan"),
                "node_location": service.get("node_location"),
                "ip_addresses": service.get("ip_addresses"),
                "os": service.get("os"),
            }
        )
        return Observation(
            provider=self.provider,
            instance_key=veid,
            display_name=display_name,
            status=str(live.get("ve_status") or service.get("ve_status") or "unknown"),
            metrics=metrics,
            quota=quota,
            metadata=metadata,
            raw={"service_info": service, "live_service_info": live},
        )


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}
