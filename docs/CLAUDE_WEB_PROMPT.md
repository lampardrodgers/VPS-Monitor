# 给 Claude 的 Web 界面开发 Prompt

将下面整段内容复制给 Claude Code，并同时提供 `docs/API.md` 作为接口契约。

---

你是一名资深产品设计师和前端工程师。请实现一个完整、可运行、适合长期日常使用的
“多供应商 VPS 监控中心”本地 Web 应用，不要只输出概念稿或静态 HTML。

## 项目目标

我有 RackNerd、BandwagonHost、阿里云 SWAS、Panstar、GreenCloud、DediOne 等供应商的 VPS。
后端已经统一采集 CPU、内存、磁盘、网络速率、运行状态、流量配额和历史数据，并提供
REST API。监控数据只读，只有留存设置允许 PUT；前端只在我的 Mac 本地运行，通过 SSH
隧道访问 API。

API Base URL：

```text
http://127.0.0.1:8787
```

后端同时提供缓存读取和阿里云实时查询。阿里云页面每次请求实时接口时，服务器都会重新
调用阿里云，不会复用缓存；阿里云 AccessKey 永远不进入前端。

不要在前端连接任何供应商 API，不要要求供应商 Token，不要设计登录密码输入框，也不要
把 API 发布到公网。

## 技术要求

- React + Vite + TypeScript。
- 使用 Tailwind CSS 或同等级的现代样式方案。
- 使用 TanStack Query 管理 API 请求、缓存、轮询和错误状态。
- 使用 Recharts 或 Apache ECharts 绘制曲线。
- 使用 Lucide 图标，不依赖需要 API Key 的图标或图片服务。
- API 地址通过 `VITE_API_BASE_URL` 配置，默认 `http://127.0.0.1:8787`。
- 提供格式化工具：Byte/KB/MB/GB/TB、bit/s、百分比、UTC 到本地时间、相对时间。
- 严格 TypeScript，禁止大量使用 `any`。
- 为 API 类型、格式化函数和核心状态逻辑编写测试。
- 输出完整文件结构、安装命令、运行命令和 README，确保
  `npm install && npm run dev` 可以直接启动。

## 视觉方向

设计成冷静、精确、高信息密度的基础设施控制台，不要做成营销后台模板。

- 默认深色主题，同时提供浅色主题切换并记住选择。
- 深色背景采用蓝黑/石墨色；卡片靠明度和细边框分层，不要满屏阴影。
- 正常为低饱和绿色，警告为琥珀色，失败为红色，未知为灰色。
- 不要使用大面积渐变、玻璃拟态、霓虹光效或过度圆角。
- 数字使用等宽数字样式，确保容量和百分比对齐。
- 桌面端优先，同时适配平板和手机。
- 满足键盘导航、清晰焦点、足够对比度；图表不能只依赖颜色。

## 信息架构

### 1. 总览页

顶部显示：

- API 连接状态。
- 最近更新时间及相对时间。
- SSH 隧道断开时的明确提示。
- 手动刷新按钮。

第一行 KPI：

- 实例总数。
- 在线实例数。
- 正常供应商数量，例如 `5 / 5`。
- 有固定流量配额实例的总已用/总配额。
- 无限流量实例数量。

供应商状态区：

- 供应商名称、正常/异常、实例数量、最近采集时间、最近错误。
- 错误信息支持展开，不能撑坏布局。

实例列表桌面端使用高密度表格，移动端切换为卡片：

- 实例名称、供应商、状态。
- CPU。
- 内存已用/总量和百分比。
- 磁盘已用/总量和百分比。
- 当前入站/出站速率。
- 流量已用/总量。
- 最近更新时间。

支持供应商筛选、状态筛选、名称搜索、排序、分页和列表/卡片切换。

### 2. 实例详情页或侧边详情面板

顶部显示名称、供应商、状态、区域、系统、到期时间和最后更新时间。

资源概览包括 CPU、内存、磁盘、当前上下行速率和流量配额。历史图表支持 24 小时、
7 天、30 天切换；实际保留期限通过服务端留存设置决定：

- CPU 折线。
- 内存使用量或使用率。
- 磁盘使用量或使用率。
- 上下行网络速率双折线。
- 流量累计曲线。

同一时间范围的图表共享十字准线和 Tooltip。字段缺失必须显示断点或“不支持”，绝对不能
当成零。历史只有一个点时也要正确显示。

### 3. 流量规则

- 有 `traffic_total_bytes`：显示进度条、已用、剩余、总量和百分比。
- `traffic_unlimited=true`：显示“无限流量 / 带宽型”，不要显示 0% 或 100%。
- 只有 `traffic_used_bytes`：显示已用量，并标注“供应商未返回总配额”。
- 同时存在 in/out 或 rx/tx 时，在 Tooltip 分别显示上下行累计。
- 80% 显示警告，95% 显示严重；只做视觉提示，不发送控制命令。

### 4. 错误和陈旧数据

- `/health` 无法连接：显示“SSH 隧道未连接或 API 未启动”，不要只写模糊错误。
- 某供应商 `ok=false`：保留最后成功数据，同时标记采集异常。
- 实例数据超过 10 分钟未更新：显示 stale/数据陈旧。
- 列表为空、筛选无结果、API 503、API 404 都有独立状态。
- 加载时使用骨架屏，避免整页 Spinner。

## API 契约

### 健康检查

```text
GET /health
```

```json
{
  "status": "ok",
  "database": "ok",
  "latest_observation_at": "2026-08-10T03:30:17+00:00"
}
```

### 总览

```text
GET /api/v1/summary
```

字段：`generated_at`、`providers_total`、`providers_ok`、`instances_total`、
`instances_online`、`instances_unlimited_traffic`、`traffic_used_bytes`、
`traffic_total_bytes`。

### 供应商

```text
GET /api/v1/providers
```

响应 `items[]` 字段：`provider`、`ok`、`instance_count`、`last_collected_at`、
`last_error`。

### 实例列表

```text
GET /api/v1/instances?provider=&status=&search=&offset=0&limit=100
```

```ts
type InstanceObservation = {
  provider: string;
  instance_key: string;
  display_name: string;
  observed_at: string;
  status: string | null;
  metrics: Record<string, number | string | boolean | null>;
  quota: Record<string, number | string | boolean | null>;
  metadata: Record<string, unknown>;
  active: boolean;
  removed_at: string | null;
};

type InstanceListResponse = {
  total: number;
  offset: number;
  limit: number;
  items: InstanceObservation[];
};
```

实例列表默认只返回当前仍存在的实例。管理历史实例时使用
`GET /api/v1/instances?include_removed=true`；`active=false` 表示供应商最近一次成功采集
已经不再返回该实例，但其详情和历史接口仍然可读。

### 单个实例

```text
GET /api/v1/instances/{provider}/{instance_key}
```

### 历史数据

```text
GET /api/v1/instances/{provider}/{instance_key}/history?hours=24&limit=1000
```

响应 `points[]` 包含 `observed_at`、`status`、`metrics`、`quota`，并按时间升序排列。
30 天视图请请求 `hours=720&limit=10000`。

### 阿里云实时查询

```text
GET /api/v1/live/aliyun_swas
```

```ts
type LiveQueryResponse = {
  provider: "aliyun_swas";
  requested_at: string;
  completed_at: string;
  duration_ms: number;
  total: number;
  items: InstanceObservation[];
};
```

这个接口每调用一次都会在服务端发起一轮新的阿里云查询，响应带
`Cache-Control: no-store`。收到结果后，以 `provider + instance_key` 为键覆盖界面中对应
阿里云实例的缓存数据；其他供应商实例保持不变。

常见 `metrics`：

```text
cpu_percent
memory_used_bytes
memory_available_bytes
memory_total_bytes
disk_used_bytes
disk_total_bytes
network_in_bps
network_out_bps
load_average
disk_read_iops
disk_write_iops
```

常见 `quota`：

```text
traffic_used_bytes
traffic_total_bytes
traffic_remaining_bytes
traffic_in_bytes
traffic_out_bytes
traffic_rx_bytes
traffic_tx_bytes
traffic_reset_at
traffic_unlimited
traffic_billing_mode
```

不同供应商支持的字段不同。字段不存在表示不支持或没有数据。

## 请求策略

- `/health` 每 30 秒轮询。
- `/summary`、`/providers`、`/instances` 默认每 5 分钟轮询。
- 阿里云实时刷新间隔由前端控制，提供“关闭、30 秒、60 秒、5 分钟”选项，默认 5 分钟，
  并将选择保存在本地。每次到期调用 `/api/v1/live/aliyun_swas`，禁止通过 Query 缓存或
  Service Worker 复用响应。
- 页面失去焦点时降低或暂停轮询，恢复焦点后立即刷新。
- 历史接口只在进入详情或切换时间范围时请求。
- 刷新时保留上一轮成功数据，不要闪空。
- 请求失败使用指数退避，最长不超过 5 分钟。
- 实时接口返回 502 时保留上一轮成功数据并明确显示“阿里云实时查询失败”；不要为了
  补偿错误立即高频重试。

## 安全约束

- 不实现关机、重启、重装等供应商控制操作。
- 不读取或展示 API Key、Token、SSH/VNC 密码或原始响应。
- 不增加登录系统；访问控制由本机和 SSH 隧道完成。
- 不把真实服务器 IP 写死在前端。
- 不添加公网部署教程，不建议把 API 绑定到 `0.0.0.0`。

## 交付要求

1. 先简述页面结构和设计系统，然后直接实现。
2. 输出完整源码，不停留在 Figma 描述或伪代码。
3. 提供 `.env.example`、README、安装和启动命令。
4. 提供 API Client、TypeScript 类型、Query Hooks、页面和组件。
5. 完成加载、空、错误、陈旧和部分字段缺失状态。
6. 可提供开发期 mock，但默认必须调用真实 API，生产构建不得静默回退 mock。
7. 最后运行类型检查、测试和生产构建，修复全部错误后再交付。

---
