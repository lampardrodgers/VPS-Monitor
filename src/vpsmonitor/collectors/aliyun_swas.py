from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from ..config import resolve_secret
from ..models import Observation
from ..util import as_number, bytes_from, deep_find, first_mapping_list
from .base import Collector, ProviderError


METRICS = {
    "CPU_UTILIZATION": ("cpu_percent", "number"),
    "MEMORY_ACTUALUSEDSPACE": ("memory_used_bytes", "bytes"),
    "DISKUSAGE_USED": ("disk_used_bytes", "bytes"),
    "VPC_PUBLICIP_INTERNETOUT_RATE": ("network_out_bps", "number"),
    "VPC_PUBLICIP_INTERNETIN_RATE": ("network_in_bps", "number"),
    "DISK_READ_IOPS": ("disk_read_iops", "number"),
    "DISK_WRITE_IOPS": ("disk_write_iops", "number"),
    "FLOW_USED": ("flow_used_bytes", "bytes"),
}


class AliyunSwasCollector(Collector):
    provider = "aliyun_swas"

    def collect(self) -> list[Observation]:
        region_id = str(self.config.get("region_id") or "").strip()
        if not region_id:
            raise ProviderError("aliyun_swas.region_id 未配置")
        access_key_id = resolve_secret(
            self.config.get("access_key_id"), field="aliyun_swas.access_key_id"
        )
        access_key_secret = resolve_secret(
            self.config.get("access_key_secret"), field="aliyun_swas.access_key_secret"
        )
        client, models, runtime_options = self._client(
            access_key_id, access_key_secret, region_id
        )
        try:
            list_request = models.ListInstancesRequest(
                region_id=region_id,
                page_number=1,
                page_size=100,
            )
            list_response = client.list_instances_with_options(list_request, runtime_options)
            list_payload = _to_map(list_response.body)
        except Exception as exc:  # SDK wraps provider-specific exceptions.
            raise ProviderError(f"阿里云 ListInstances 失败：{type(exc).__name__}") from exc

        instances = first_mapping_list(
            list_payload.get("Instances")
            or list_payload.get("instances")
            or list_payload
        )
        configured_ids = {str(value) for value in (self.config.get("instance_ids") or [])}
        if configured_ids:
            instances = [
                item
                for item in instances
                if str(deep_find(item, ("InstanceId", "instance_id"))) in configured_ids
            ]
        if not instances:
            raise ProviderError("阿里云轻量 API 没有返回实例")

        instance_ids = [
            str(deep_find(item, ("InstanceId", "instance_id"))) for item in instances
        ]
        traffic_by_instance = self._traffic(
            client, models, runtime_options, region_id, instance_ids
        )
        observations = []
        for item in instances:
            instance_id = str(deep_find(item, ("InstanceId", "instance_id")))
            metric_payloads, normalized_metrics = self._metrics(
                client, models, runtime_options, region_id, instance_id
            )
            observations.append(
                self._observation(
                    region_id,
                    instance_id,
                    item,
                    normalized_metrics,
                    metric_payloads,
                    traffic_by_instance.get(instance_id),
                )
            )
        return observations

    @staticmethod
    def _client(
        access_key_id: str,
        access_key_secret: str,
        region_id: str,
    ) -> tuple[Any, Any, Any]:
        try:
            from alibabacloud_swas_open20200601 import models
            from alibabacloud_swas_open20200601.client import Client
            from alibabacloud_tea_openapi import models as open_api_models
            from alibabacloud_tea_util import models as util_models
        except ImportError as exc:
            raise ProviderError("缺少阿里云 SWAS SDK，请先运行 uv sync") from exc
        config = open_api_models.Config(
            access_key_id=access_key_id,
            access_key_secret=access_key_secret,
        )
        config.endpoint = f"swas.{region_id}.aliyuncs.com"
        return Client(config), models, util_models.RuntimeOptions()

    def _traffic(
        self,
        client: Any,
        models: Any,
        runtime_options: Any,
        region_id: str,
        instance_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        try:
            request = models.ListInstancesTrafficPackagesRequest(
                region_id=region_id,
                instance_ids=json.dumps(instance_ids),
            )
            response = client.list_instances_traffic_packages_with_options(
                request, runtime_options
            )
            payload = _to_map(response.body)
        except Exception as exc:
            raise ProviderError(
                f"阿里云 ListInstancesTrafficPackages 失败：{type(exc).__name__}"
            ) from exc
        entries = first_mapping_list(
            payload.get("InstanceTrafficPackageUsages")
            or payload.get("instance_traffic_package_usages")
            or payload
        )
        return {
            str(deep_find(item, ("InstanceId", "instance_id"))): item
            for item in entries
        }

    def _metrics(
        self,
        client: Any,
        models: Any,
        runtime_options: Any,
        region_id: str,
        instance_id: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        end = datetime.now(UTC).replace(microsecond=0)
        start = end - timedelta(hours=2)
        raw: dict[str, Any] = {}
        normalized: dict[str, Any] = {}
        for metric_name, (output_key, value_type) in METRICS.items():
            period = "3600" if metric_name == "FLOW_USED" else "60"
            try:
                request = models.DescribeMonitorDataRequest(
                    region_id=region_id,
                    instance_id=instance_id,
                    metric_name=metric_name,
                    period=period,
                    start_time=start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    end_time=end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    length="120",
                )
                response = client.describe_monitor_data_with_options(
                    request, runtime_options
                )
                payload = _to_map(response.body)
                raw[metric_name] = payload
                value = _latest_datapoint(payload.get("Datapoints") or payload.get("datapoints"))
                if value is not None:
                    normalized[output_key] = (
                        bytes_from(value) if value_type == "bytes" else as_number(value)
                    )
            except Exception as exc:
                raw[metric_name] = {"collector_error": type(exc).__name__}
        return raw, {key: value for key, value in normalized.items() if value is not None}

    def _observation(
        self,
        region_id: str,
        instance_id: str,
        instance: dict[str, Any],
        metrics: dict[str, Any],
        metric_payloads: dict[str, Any],
        traffic: dict[str, Any] | None,
    ) -> Observation:
        traffic = traffic or {}
        traffic_used = bytes_from(deep_find(traffic, ("TrafficUsed", "traffic_used")))
        traffic_total = bytes_from(
            deep_find(traffic, ("TrafficPackageTotal", "traffic_package_total"))
        )
        traffic_remaining = bytes_from(
            deep_find(traffic, ("TrafficPackageRemaining", "traffic_package_remaining"))
        )
        resource_spec = instance.get("ResourceSpec")
        if not isinstance(resource_spec, dict):
            resource_spec = instance.get("resource_spec")
        if not isinstance(resource_spec, dict):
            resource_spec = {}
        flow_gb = as_number(resource_spec.get("Flow", resource_spec.get("flow")))
        peak_bandwidth = as_number(
            resource_spec.get("Bandwidth", resource_spec.get("bandwidth"))
        )
        bandwidth_billed = (
            not traffic
            and peak_bandwidth is not None
            and (flow_gb is None or flow_gb == 0)
        )
        quota = _without_none(
            {
                "traffic_used_bytes": traffic_used,
                "traffic_total_bytes": traffic_total,
                "traffic_remaining_bytes": traffic_remaining,
                "traffic_overflow_bytes": bytes_from(
                    deep_find(traffic, ("TrafficOverflow", "traffic_overflow"))
                ),
                "traffic_unlimited": True if bandwidth_billed else None,
                "traffic_billing_mode": "bandwidth" if bandwidth_billed else None,
            }
        )
        memory_total = bytes_from(
            deep_find(instance, ("Memory", "memory", "MemorySize", "memory_size")),
            "gib",
        )
        disk_total = bytes_from(
            deep_find(instance, ("DiskSize", "disk_size", "SystemDiskSize")),
            "gib",
        )
        if memory_total is not None:
            metrics.setdefault("memory_total_bytes", memory_total)
        if disk_total is not None:
            metrics.setdefault("disk_total_bytes", disk_total)
        metadata = _without_none(
            {
                "region_id": region_id,
                "ip": deep_find(instance, ("PublicIpAddress", "public_ip_address")),
                "private_ip": deep_find(instance, ("InnerIpAddress", "inner_ip_address")),
                "image": deep_find(instance, ("ImageId", "image_id")),
                "plan_id": deep_find(instance, ("PlanId", "plan_id")),
                "peak_bandwidth_mbps": peak_bandwidth,
                "expires_at": deep_find(instance, ("ExpiredTime", "expired_time")),
            }
        )
        name = deep_find(instance, ("InstanceName", "instance_name", "Name", "name"))
        status = deep_find(instance, ("Status", "status"))
        return Observation(
            provider=self.provider,
            instance_key=instance_id,
            display_name=str(name or f"Aliyun-{instance_id}"),
            status=str(status or "unknown"),
            metrics=metrics,
            quota=quota,
            metadata=metadata,
            raw={
                "instance": instance,
                "traffic_package": traffic,
                "monitor_data": metric_payloads,
            },
        )


def _to_map(value: Any) -> dict[str, Any]:
    if hasattr(value, "to_map"):
        result = value.to_map()
    elif isinstance(value, dict):
        result = value
    else:
        result = {}
    return result if isinstance(result, dict) else {}


def _latest_datapoint(value: Any) -> Any:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    if not isinstance(value, list) or not value:
        return None
    latest = value[-1]
    if isinstance(latest, dict):
        return deep_find(latest, ("Average", "average", "Value", "value", "Maximum", "maximum"))
    return latest


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}
