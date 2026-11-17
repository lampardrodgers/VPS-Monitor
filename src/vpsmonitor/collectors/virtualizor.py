from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

from ..config import resolve_secret
from ..models import Observation
from ..util import as_number, bytes_from, deep_find, first_mapping_list
from .base import Collector, ProviderError, response_json

SUB_ACTIONS = ("vpsmanage", "ram", "cpu", "disk", "bandwidth")
MIN_VIRTUALIZOR_TIMEOUT_SECONDS = 60.0


class VirtualizorCollector(Collector):
    provider = "dedione"

    def collect(self) -> list[Observation]:
        base_url = str(self.config.get("base_url") or "").rstrip("/")
        if not base_url:
            raise ProviderError("dedione.base_url 未配置")
        api_key = resolve_secret(self.config.get("api_key"), field="dedione.api_key")
        api_pass = resolve_secret(self.config.get("api_pass"), field="dedione.api_pass")
        verify_tls = bool(self.config.get("verify_tls", True))
        request_timeout = (
            self.timeout
            if self.config.get("timeout_seconds") is not None
            else max(self.timeout, MIN_VIRTUALIZOR_TIMEOUT_SECONDS)
        )
        auth = {"api": "json", "apikey": api_key, "apipass": api_pass}
        with self.client(verify=verify_tls, timeout=request_timeout) as client:
            list_payload = self._call(client, base_url, auth, "listvs")
            configured_ids = [str(value) for value in (self.config.get("vps_ids") or [])]
            instances = self._instances(list_payload)
            if configured_ids:
                instances = [item for item in instances if str(item[0]) in configured_ids]
            if not instances:
                raise ProviderError("Virtualizor 没有返回 VPS")
            status_map = list_payload.get("status") if isinstance(list_payload.get("status"), dict) else {}
            results: list[Observation] = []
            for vps_id, summary in instances:
                raw: dict[str, Any] = {
                    "list_item": summary,
                    "list_status": status_map.get(vps_id),
                }

                def fetch_action(action: str, target_id: str = vps_id) -> tuple[str, dict[str, Any]]:
                    try:
                        return action, self._call(client, base_url, auth, action, svs=target_id)
                    except (ProviderError, httpx.HTTPError) as exc:
                        return action, {"collector_error": type(exc).__name__}

                with ThreadPoolExecutor(max_workers=3) as executor:
                    for action, action_payload in executor.map(fetch_action, SUB_ACTIONS):
                        raw[action] = action_payload
                results.append(self._observation(vps_id, summary, raw))
            return results

    @staticmethod
    def _call(
        client: Any,
        base_url: str,
        auth: dict[str, str],
        action: str,
        **params: Any,
    ) -> dict[str, Any]:
        query = {**auth, "act": action, **params}
        payload = response_json(client.get(f"{base_url}/index.php", params=query))
        if not isinstance(payload, dict):
            raise ProviderError(f"Virtualizor {action} 返回格式异常")
        return payload

    @staticmethod
    def _instances(payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
        source = payload.get("vs") or payload.get("vps") or payload.get("data") or {}
        if isinstance(source, dict):
            return [(str(key), value) for key, value in source.items() if isinstance(value, dict)]
        values = first_mapping_list(source)
        result = []
        for value in values:
            vps_id = deep_find(value, ("vpsid", "vps_id", "id", "svs"))
            if vps_id is not None:
                result.append((str(vps_id), value))
        return result

    def _observation(
        self,
        vps_id: str,
        summary: dict[str, Any],
        raw: dict[str, Any],
    ) -> Observation:
        combined = raw
        info = _info_mapping(raw)
        vps_info = info.get("vps") if isinstance(info.get("vps"), dict) else summary
        cached_disk = _cached_disk(vps_info) or _cached_disk(summary)
        ram = _nested_metrics(raw, "ram")
        cpu = _nested_metrics(raw, "cpu")
        disk = _nested_metrics(raw, "disk")
        bandwidth = _nested_metrics(raw, "bandwidth")
        if not bandwidth and isinstance(info.get("bandwidth"), dict):
            bandwidth = info["bandwidth"]

        ram_total = bytes_from(ram.get("limit"), "mib")
        if ram_total is None:
            ram_total = bytes_from(vps_info.get("ram"), "mib")
        ram_used = bytes_from(ram.get("used"), "mib")
        disk_total = bytes_from(disk.get("limit"), "mib")
        if disk_total is None:
            disk_total = bytes_from(vps_info.get("space"), "gib")
        disk_used = bytes_from(disk.get("used"), "mib")
        if disk_used is None:
            disk_used = bytes_from(cached_disk.get("Used"), "kib")
        metrics = _without_none(
            {
                "cpu_percent": as_number(cpu.get("percent")),
                "memory_used_bytes": ram_used,
                "memory_total_bytes": ram_total,
                "disk_used_bytes": disk_used,
                "disk_total_bytes": disk_total,
                "network_in_bps": as_number(deep_find(combined, ("net_in_speed", "in_speed", "rx_rate"))),
                "network_out_bps": as_number(deep_find(combined, ("net_out_speed", "out_speed", "tx_rate"))),
            }
        )
        traffic_used = bytes_from(bandwidth.get("used"), "mib")
        if traffic_used is None:
            traffic_used = bytes_from(vps_info.get("used_bandwidth"), "gib")
        traffic_total = (
            bytes_from(bandwidth.get("limit"), "mib")
            if bandwidth
            else bytes_from(vps_info.get("bandwidth"), "gib")
        )
        if traffic_total == 0:
            traffic_total = None
        quota = _without_none(
            {
                "traffic_used_bytes": traffic_used,
                "traffic_total_bytes": traffic_total,
                "traffic_remaining_bytes": (
                    max(0, traffic_total - traffic_used)
                    if traffic_total is not None and traffic_used is not None
                    else None
                ),
            }
        )
        name = deep_find(summary, ("hostname", "name")) or deep_find(vps_info, ("hostname", "name"))
        numeric_status = info.get("status") if "status" in info else deep_find(raw.get("vpsmanage", {}), ("status",))
        if numeric_status is None:
            numeric_status = deep_find(raw.get("list_status"), ("status",))
        if numeric_status is None and not isinstance(raw.get("list_status"), dict):
            numeric_status = raw.get("list_status")
        if numeric_status is None:
            numeric_status = summary.get("status")
        if str(numeric_status) == "1":
            status = "running"
        elif str(numeric_status) == "0":
            status = "stopped"
        else:
            status = str(numeric_status or "unknown")
        metadata = _without_none(
            {
                "vps_id": vps_id,
                "ip": deep_find(summary, ("ips", "ip", "primary_ip")) or info.get("ip"),
                "os": deep_find(combined, ("os_name", "os", "distro")),
            }
        )
        return Observation(
            provider=self.provider,
            instance_key=vps_id,
            display_name=str(name or f"DediOne-{vps_id}"),
            status=str(status or "unknown"),
            metrics=metrics,
            quota=quota,
            metadata=metadata,
            raw=raw,
        )


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def _nested_metrics(raw: dict[str, Any], name: str) -> dict[str, Any]:
    response = raw.get(name)
    if not isinstance(response, dict):
        return {}
    value = response.get(name)
    return value if isinstance(value, dict) else {}


def _info_mapping(raw: dict[str, Any]) -> dict[str, Any]:
    response = raw.get("vpsmanage")
    if not isinstance(response, dict):
        return {}
    info = response.get("info")
    return info if isinstance(info, dict) else {}


def _cached_disk(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    cached = value.get("cached_disk")
    if not isinstance(cached, dict):
        return {}
    disk = cached.get("disk")
    return disk if isinstance(disk, dict) else {}
