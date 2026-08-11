# VPS 监控中心 · Web 界面

多供应商 VPS 监控面板。数据全部来自本机 SSH 隧道后面的
[监控 API](https://github.com/lampardrodgers/VPS-Monitor/blob/api/docs/API.md)。监控数据只读，
仅留存设置使用 PUT；前端不接触任何供应商 Token，也不执行开关机、重装等控制操作。

- React 19 + Vite 7 + TypeScript（strict）
- TanStack Query 负责请求、缓存、轮询、退避重试
- Recharts 绘制历史曲线，Lucide 提供图标
- Tailwind CSS v4，深色/浅色双主题

## 快速开始

```bash
# 首次使用：把私有 SSH 配置放在源码目录外
mkdir -p ~/.config/vpsmonitor/web
cp .env.example ~/.config/vpsmonitor/web/.env.local
# 保持 VPSMON_SSH_ON_DEMAND=1，并填写 VPSMON_SSH_TARGET

# 启动前端；只有发起 API 请求时才会临时连接 SSH
npm install
npm run dev
```

按需模式使用 SSH Key 和 `BatchMode`，不会在后台等待密码。每轮刷新开始时建立一条临时
端口转发，同一轮的并发 API 请求共用这条连接，最后一个请求完成后即关闭；Web 服务空闲时不会
常驻 SSH 进程。正常关闭 Vite 时也会强制清理尚未结束的临时连接。

首次使用前应先手动执行一次 `ssh user@<SERVER_IP>`，确认主机指纹并确保 Key 可以免密登录。
若要自行管理固定隧道，将 `VPSMON_SSH_ON_DEMAND=0`，把 `VITE_API_BASE_URL` 改回
`http://127.0.0.1:8787`，再手动执行 `ssh -N -L 8787:127.0.0.1:18787 user@<SERVER_IP>`。

打开终端里输出的地址（默认 <http://127.0.0.1:5273>）。

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 类型检查 + 生产构建到 `dist/` |
| `npm run preview` | 预览生产构建 |
| `npm run typecheck` | 只跑类型检查 |
| `npm test` | 运行 Vitest 单元测试 |

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | `/__vpsmonitor_api` | 浏览器访问的同源 API 代理路径 |
| `VITE_USE_MOCK` | 未设置 | 设为 `1` 时用内置假数据，**仅开发模式生效** |
| `VPSMON_SSH_ON_DEMAND` | `1` | 每轮 API 请求临时建立 SSH，结束后关闭 |
| `VPSMON_SSH_TARGET` | - | SSH 目标，例如 `root@server.example.com` |
| `VPSMON_SSH_LOCAL_PORT` | `0` | 本机转发端口；`0` 表示每轮自动分配空闲端口 |
| `VPSMON_SSH_REMOTE_HOST` | `127.0.0.1` | VPS 上 API 监听地址 |
| `VPSMON_SSH_REMOTE_PORT` | `18787` | VPS 上 API 监听端口 |
| `VPSMON_SSH_IDENTITY_FILE` | SSH 默认配置 | 可选的私钥路径 |
| `VPSMON_SSH_IDLE_MS` | `500` | 最后一个请求后的并发合并窗口（毫秒） |

可用 `VPSMON_WEB_CONFIG_DIR` 覆盖外部配置目录。项目内 `.env.local` 仍可用于临时开发，
但已被 Git 忽略，不应打包或提交。

Mock 只在 `import.meta.env.DEV` 为真时安装，生产构建会把整段代码摇树移除：
真实 API 挂掉时界面会明确报错，绝不会静默回退到假数据。

```bash
VITE_USE_MOCK=1 npm run dev     # 无隧道时预览各种状态（含 86% 流量告警、离线实例）
```

## 界面结构

**总览页**

- 顶栏：API 连接状态、最近采集时间与相对时间、**供应商按钮**、曲线/日志留存设置、自动刷新间隔、手动刷新、主题切换。
- 供应商按钮显示 `正常数/总数`，有采集失败时变红；点开在按钮下方浮出弹层（不挤压正文），
  列出每家的正常/异常、实例数、最近采集时间和可展开的错误详情，点某一家即按它筛选并收起，
  点弹层外任意位置或按 `Esc` 也会收起。
- KPI：实例总数、在线实例、采集正常的供应商、固定配额流量已用/总量、无限流量实例数。
- 实例列表：桌面端高密度表格（实例 / 状态 / CPU / 内存 / 磁盘 / 流量 / 更新），窄屏自动切卡片；
  支持供应商/状态/关键字筛选、点列排序、分页与列表‑卡片切换。筛选、排序、分页全在客户端完成，
  切条件不重新请求。表格用固定列宽，名称列保持紧凑，宽度留给右侧指标；瞬时网络速率只在详情里看。

**实例详情**（点任意一行，或直接访问 `?provider=<供应商>&instance=<实例键>`）

- 名称、供应商、状态、区域、系统、套餐、配置、到期时间、最后更新。
- 资源概览：CPU、内存、磁盘、上下行速率、系统负载。
- 流量配额卡片。
- 历史曲线：CPU、内存、磁盘、网络速率（双线）、流量累计，支持 24 小时 / 7 天 / 30 天，
  同一时间轴共享十字准线与 Tooltip。

**键盘**：`/` 聚焦搜索，`Esc` 清空搜索或关闭详情，表格行可 Tab 聚焦后回车打开。

## 数据处理约定

这些规则集中实现在 `src/lib/`，并有单元测试覆盖：

- **字段缺失 ≠ 0**。各家供应商返回的指标不同，缺失一律显示 `—` 或“该供应商不提供此指标”，
  曲线断开而不是补零（`lib/values.ts`、`lib/series.ts`）。
- **使用率配色**（`lib/status.ts` 的 `usageTone`）：CPU、内存、磁盘、流量配额共用一套阈值，
  超过 50% 转黄、超过 80% 转红，缺失值画成空槽而不是 0%。
- **流量三种形态**（`lib/traffic.ts`）：
  - `traffic_total_bytes` 存在 → 进度条 + 已用/剩余/总量/百分比；
  - `traffic_unlimited=true` → “无限流量 / 带宽型”（阿里云带宽型），不显示百分比；
  - 只有 `traffic_used_bytes`、没有任何配额上限 → 同样按**无限流量**处理（DediOne 这类套餐），
    显示真实已用量 + “无限流量”标签，详情里注明是根据“没有配额上限”推断的；
  - 什么都没有 → 显示 `—`。
  - 供应商返回 `traffic_reset_at` 时（目前只有搬瓦工），列表流量列补一行 `重置 08-11 10:18`，
    详情卡片显示完整时间与倒计时；没有该字段的供应商不占位。
- **流量统计口径**：顶部“无限流量”和“固定配额流量”两块由前端根据上面的规则从实例列表
  自己汇总（`rollupTraffic`），不用 `/api/v1/summary` 里的流量字段——后端只认
  `traffic_unlimited=true`，会把“只有用量”的实例算进已用总量，和界面显示对不上。
- **状态归一**（`lib/status.ts`）：`running` / `Running` / `READY` / `1` 都算在线，
  未见过的状态如实展示但不当成在线。
- **数据陈旧**：超过 10 分钟没有新采集就打 `数据陈旧` 标记。其他供应商读取后端 SQLite；
  阿里云 SWAS 由服务器实时查询并覆盖当前卡片，AccessKey 仍只保留在服务器。
- **单位**：容量按 1024 进制（`GB` = 1024³ B），网络速率按 1000 进制（`Mbps`），
  时间从 UTC 转本地时区显示。

## 请求策略

| 接口 | 频率 |
|---|---|
| `/health`、`/summary`、`/providers`、`/instances` | 顶栏可选 30 秒 / 1 分钟 / 5 分钟 / 关闭，默认 5 分钟 |
| `/api/v1/live/aliyun_swas` | 页面打开时请求一次，之后跟随顶栏间隔，默认 5 分钟；响应不使用浏览器缓存 |
| `/instances/{...}/history` | 只在打开详情或切换时间范围时请求 |

- 实例列表一次取回全量（自动翻页），筛选/排序/分页在客户端完成。
- 页面失去焦点时暂停轮询，重新聚焦立即刷新。
- 刷新时保留上一轮数据（`keepPreviousData`），不会闪空。
- 失败按指数退避重试，上限 5 分钟；`404`/`422` 不重试。每次重试都会新建临时 SSH，
  连接成功后界面会自动恢复，不需刷新浏览器。

## 新增 VPS / 新增供应商

**通常什么都不用改。** 界面完全由 API 数据驱动：

- 新实例只要出现在 `/api/v1/instances`，就会自动出现在列表、筛选项和统计里。
- 新供应商会自动获得可读名称（`new_cloud` → `New Cloud`）和稳定色相。
- 新指标字段只要在 `metrics` 里出现，历史曲线的对应图表就会从“不提供”变成有数据。

只有想自定义时才需要动代码：

| 想做的事 | 改哪里 |
|---|---|
| 给供应商配中文名/固定配色 | `src/lib/providers.ts` 的 `PROVIDER_REGISTRY` 加一行 |
| 新增一张历史图表 | `src/components/detail/HistoryCharts.tsx` 的 `CHARTS` 加一项 |
| 新增列表列 | `src/components/InstanceTable.tsx` 的 `COLUMNS` + 行渲染 |
| 新增可排序字段 | `src/lib/list.ts` 的 `SortKey` 与 `sortValue` |
| 识别新的状态字符串 | `src/lib/status.ts` 的 `ONLINE` / `OFFLINE` / `TRANSITIONAL` |
| 调整进度条黄/红阈值 | `src/lib/status.ts` 的 `USAGE_WARN_PERCENT` / `USAGE_CRIT_PERCENT` |
| 调整配色 | `src/index.css` 顶部的 CSS 变量（`:root` 与 `.dark` 各一套） |

实例数量超过 500（API 单页上限）时，客户端会自动翻页取全量，上限 2000 条。

## 目录结构

```text
web/
├── index.html                 # 首帧前应用主题，避免闪白
├── src/
│   ├── api/                   # 类型契约、响应解析、HTTP 客户端、Query hooks
│   │   ├── types.ts           # 与 docs/API.md 对齐的接口类型
│   │   ├── parse.ts           # 宽松解析：容忍新字段，拒绝脏数据
│   │   ├── client.ts          # 访问同源 API 代理，含超时与全量翻页
│   │   ├── errors.ts          # 区分隧道断开 / 数据库不可用 / 404 / 422
│   │   └── queries.ts         # 轮询、退避、keepPreviousData
│   ├── components/            # 顶栏、KPI、供应商、列表、详情抽屉、图表、UI 原语
│   ├── hooks/                 # 偏好（主题/间隔/视图/页大小）、时钟、URL 选中态
│   ├── lib/                   # 格式化、取值、状态、流量、实例视图模型、列表逻辑、曲线
│   └── mock/                  # 开发期假数据（生产构建自动剔除）
└── src/**/*.test.ts           # Vitest：107 个用例覆盖上述纯逻辑
```

## 安全边界

- 只发起 `GET`，没有任何控制类操作。
- 不读取、不展示 API Key、Token、SSH/VNC 密码或供应商原始响应。
- 不展示服务器公网 IP，也不把任何 IP 写进前端代码。
- 没有登录系统：访问控制由“只监听本机 + SSH 隧道”完成，不要把本服务或 API 暴露到公网。
