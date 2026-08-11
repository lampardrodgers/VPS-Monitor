# VPS Monitor Read API

## 1. 用途与访问方式

该 API 从 VPS 上的 SQLite 监控数据库读取数据，供本地 Web、桌面 App 或脚本展示。
监控数据接口只读，只有留存期限允许更新。它不会调用供应商控制操作，也不会返回 Token、
API Key、登录密码或原始供应商响应。

生产服务只监听服务器的 `127.0.0.1:18787`。先从本地电脑建立 SSH 隧道，
映射为本地的 `8787` 端口：

```bash
ssh -N -L 8787:127.0.0.1:18787 root@<SERVER_IP>
```

隧道保持运行时，本地 Base URL 为 `http://127.0.0.1:8787`。

```bash
curl http://127.0.0.1:8787/health
```

- Swagger UI：`http://127.0.0.1:8787/docs`
- ReDoc：`http://127.0.0.1:8787/redoc`
- OpenAPI：`http://127.0.0.1:8787/openapi.json`

不要把服务改为监听 `0.0.0.0`，也不要在阿里云防火墙开放 `18787` 端口。

## 2. 通用约定

- 除留存设置的 `PUT` 外，监控接口均为只读 `GET`。
- 时间使用 UTC ISO 8601。
- 容量和流量使用 Byte；网络速率使用 bit/s（`_bps`）。
- 某供应商不提供某项数据时字段会被省略，前端不能把缺失值当成 `0`。
- 后端每 5 分钟采集，前端每 60 秒刷新最新值即可。
- 响应永远不包含 `raw` 字段。
- 供应商成功采集后，本轮未再出现的实例会标记为已移除；默认列表和总览只统计活跃实例。
- 5 分钟粒度历史默认保留 7 天；每台实例始终保留最后一条状态。
- 供应商完整原始响应不落盘，API 只读取规范化后的指标。

## 3. 两种数据读取模式

### 缓存接口

`/api/v1/summary`、`/api/v1/providers`、`/api/v1/instances` 和历史接口读取服务器
SQLite 中最近一次采集结果，不会在每个 HTTP 请求中访问供应商。适合总览、列表和历史图表。
历史保留期限由服务端设置决定，初始默认 7 天。客户端请求更长时间范围不会报错，但只会
返回仍在保留期内的数据。

### 阿里云实时接口

```text
GET /api/v1/live/aliyun_swas
```

该接口不读取监控数据库缓存。服务器默认至少间隔 30 秒才会重新执行一轮阿里云 SWAS
查询；间隔内的请求复用最近结果，并发请求会合并为一次供应商查询。一次本地 HTTP
请求会在服务端组合实例列表、流量套餐和多个监控指标的阿里云上游请求。

```json
{
  "provider": "aliyun_swas",
  "requested_at": "2026-08-10T06:00:00+00:00",
  "completed_at": "2026-08-10T06:00:03+00:00",
  "duration_ms": 3120,
  "total": 1,
  "items": [
    {
      "provider": "aliyun_swas",
      "instance_key": "example-instance",
      "display_name": "Example Aliyun SWAS",
      "observed_at": "2026-08-10T06:00:03+00:00",
      "status": "Running",
      "metrics": {
        "cpu_percent": 5.1,
        "memory_used_bytes": 734003200,
        "memory_total_bytes": 2147483648,
        "disk_used_bytes": 5368709120,
        "disk_total_bytes": 42949672960,
        "network_in_bps": 12000,
        "network_out_bps": 8000
      },
      "quota": {
        "traffic_unlimited": true,
        "traffic_billing_mode": "bandwidth"
      },
      "metadata": {"region_id":"cn-hangzhou"}
    }
  ]
}
```

- 响应包含 `Cache-Control: no-store`，浏览器不得缓存；服务端仍按最小间隔复用结果。
- `X-VPSMonitor-Live-Cache` 为 `hit` 或 `miss`，表示本次是否复用服务端结果。
- 最小间隔由 `VPSMON_LIVE_MIN_INTERVAL_SECONDS` 配置，且不会低于 30 秒。
- AccessKey 只在服务器读取，前端请求中不需要也绝不能携带阿里云 AK。
- 阿里云调用失败返回 HTTP `502`，配置不可用返回 `503`。

### RackNerd / SolusVM 字段范围

RackNerd 使用每台 VPS 独立的 SolusVM 1 Client API 凭据。采集器仅调用只读的 `info` 和
`status`：可获得在线状态、主 IP、主机名、磁盘总量以及周期流量总额、已用和剩余。部分
KVM 套餐的内存会返回 `0,0,0,0`，磁盘已用也可能固定返回 0，因此后端会省略这些不可靠的占用
值；该接口也不提供 CPU 使用率和实时网络速率。虽然同一套凭据可能支持电源控制，本项目
不调用也不暴露这些动作。

常见 `metrics`：

| 字段 | 含义 | 单位 |
|---|---|---|
| `cpu_percent` | CPU 使用率 | % |
| `memory_used_bytes` | 已用内存 | Byte |
| `memory_available_bytes` | 可用内存 | Byte |
| `memory_total_bytes` | 总内存 | Byte |
| `disk_used_bytes` | 已用磁盘 | Byte |
| `disk_total_bytes` | 总磁盘 | Byte |
| `network_in_bps` | 当前入站速率 | bit/s |
| `network_out_bps` | 当前出站速率 | bit/s |
| `load_average` | 系统负载 | number |
| `disk_read_iops` | 磁盘读 IOPS | ops/s |
| `disk_write_iops` | 磁盘写 IOPS | ops/s |

常见 `quota`：

| 字段 | 含义 | 单位 |
|---|---|---|
| `traffic_used_bytes` | 周期内已用流量 | Byte |
| `traffic_total_bytes` | 周期总配额 | Byte |
| `traffic_remaining_bytes` | 周期剩余流量 | Byte |
| `traffic_in_bytes` / `traffic_rx_bytes` | 入站累计 | Byte |
| `traffic_out_bytes` / `traffic_tx_bytes` | 出站累计 | Byte |
| `traffic_reset_at` | 下一次重置时间 | ISO 8601 |
| `traffic_unlimited` | 是否无固定月流量限制 | boolean |
| `traffic_billing_mode` | 流量计费模式 | string |

阿里云带宽型实例会返回：

```json
{"traffic_unlimited":true,"traffic_billing_mode":"bandwidth"}
```

## 4. 服务状态

### `GET /health`

```json
{
  "status": "ok",
  "database": "ok",
  "latest_observation_at": "2026-08-10T03:30:17+00:00"
}
```

数据库不可用时返回 HTTP `503`：`{"detail":"监控数据库不可用"}`。

## 5. 供应商状态

### `GET /api/v1/providers`

返回每家供应商最近一次采集状态和实例数量。

```json
{
  "items": [
    {
      "provider": "greencloud",
      "ok": true,
      "instance_count": 1,
      "last_collected_at": "2026-08-10T03:30:17+00:00",
      "last_error": null
    }
  ]
}
```

`ok=false` 只表示最近一次采集失败。前端应继续显示最后一次成功数据，并标记数据可能过期。

## 6. 实例列表

### `GET /api/v1/instances`

查询每台实例的最新一条数据。

| 参数 | 类型 | 默认值 | 说明 |
|---|---:|---:|---|
| `provider` | string | - | 精确匹配供应商 |
| `status` | string | - | 精确匹配状态，不区分大小写 |
| `search` | string | - | 搜索实例名称或标识 |
| `include_removed` | boolean | `false` | 是否同时返回已移除实例 |
| `offset` | integer | `0` | 分页偏移 |
| `limit` | integer | `100` | 1–500 |

```text
GET /api/v1/instances?provider=panstar&limit=50
```

```json
{
  "total": 1,
  "offset": 0,
  "limit": 50,
  "items": [
    {
      "provider": "panstar",
      "instance_key": "example-instance",
      "display_name": "Example VPS",
      "observed_at": "2026-08-10T03:30:17+00:00",
      "status": "READY",
      "active": true,
      "removed_at": null,
      "metrics": {
        "memory_total_bytes": 536870912,
        "disk_total_bytes": 10737418240
      },
      "quota": {
        "traffic_used_bytes": 104857600,
        "traffic_total_bytes": 549755813888,
        "traffic_remaining_bytes": 549650956288
      },
      "metadata": {"cpu_cores":1,"region":"Example Region","os":"debian"}
    }
  ]
}
```

查询已经从供应商删除、但仍保留历史的实例：

```text
GET /api/v1/instances?include_removed=true
```

已移除实例返回 `active=false` 和首次确认缺失的 `removed_at`。供应商 API 临时采集失败时
不会改变库存状态，只有成功采集才能把实例标记为已移除。

## 7. 单个实例

### `GET /api/v1/instances/{provider}/{instance_key}`

响应结构与实例列表中的单个 `items[]` 相同。不存在时返回 HTTP `404`：
`{"detail":"实例不存在"}`。

已移除实例仍可通过其原有 `provider` 和 `instance_key` 查询详情。

## 8. 历史曲线

### `GET /api/v1/instances/{provider}/{instance_key}/history`

| 参数 | 默认值 | 范围 |
|---|---:|---:|
| `hours` | `24` | 1–8760 |
| `limit` | `1000` | 1–10000 |

点按时间升序排列：

```json
{
  "provider": "aliyun_swas",
  "instance_key": "example-instance",
  "hours": 24,
  "active": true,
  "removed_at": null,
  "points": [
    {
      "observed_at": "2026-08-10T03:25:17+00:00",
      "status": "Running",
      "metrics": {
        "cpu_percent": 6.2,
        "memory_used_bytes": 734003200,
        "network_in_bps": 12000,
        "network_out_bps": 8000
      },
      "quota": {"traffic_unlimited":true,"traffic_billing_mode":"bandwidth"}
    }
  ]
}
```

历史接口不会补点。图表遇到缺失字段应显示断点，不能补成零。

Web 中点击实例卡片后，详情抽屉底部的“历史曲线”可切换 24 小时、7 天和 30 天；
macOS 菜单栏 App 中点击实例进入详情，也有相同时间范围。已移除实例默认不再出现在
总览，可先用 `include_removed=true` 找到原实例标识，再直接请求其历史接口。

## 9. 总览

### `GET /api/v1/summary`

```json
{
  "generated_at": "2026-08-10T03:30:30+00:00",
  "providers_total": 5,
  "providers_ok": 5,
  "instances_total": 6,
  "instances_online": 6,
  "instances_unlimited_traffic": 1,
  "traffic_used_bytes": 2147483648,
  "traffic_total_bytes": 1099511627776
}
```

`traffic_total_bytes` 只汇总有固定配额的实例；无限流量实例单独计数。

## 10. 留存设置

### `GET /api/v1/settings/retention`

```json
{
  "history_retention_days": 7,
  "run_retention_days": 30,
  "updated_at": "2026-08-11T02:00:00+00:00"
}
```

### `PUT /api/v1/settings/retention`

```json
{"history_retention_days":30,"run_retention_days":90}
```

两个值都允许 1–3650 天。设置写入 SQLite，由后台采集器每轮读取；Web 和 Mac 修改的是
同一份服务端设置。缩短期限会立即清理过期数据，之后再调大不能恢复已经删除的曲线。
每台实例和每家供应商始终额外保留最后一条状态。

## 11. CORS 与错误

允许 `localhost` 和 `127.0.0.1` 的 HTTP/HTTPS 任意端口。其他来源不会获得 CORS
许可。API 不使用 Cookie，也不需要前端保存密钥。

- `404`：实例不存在。
- `502`：阿里云实时查询失败。
- `422`：查询参数不符合范围。
- `503`：数据库或阿里云实时查询配置不可用。

## 12. 服务维护

```bash
systemctl status vpsmonitor-api
journalctl -u vpsmonitor-api -n 100 --no-pager
systemctl restart vpsmonitor-api
```
