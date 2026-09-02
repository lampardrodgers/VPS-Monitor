# vpsmonitor

先采集、后可视化的 VPS 管理底座。当前通过各家官方/面板 API 拉取数据，规范化后统一写入 SQLite。

支持：

- RackNerd / SolusVM 1 Client API
- BandwagonHost / KiwiVM
- 阿里云轻量应用服务器 SWAS
- PanstarCloud API V1
- GreenCloud / VirtFusion 端用户 API
- DediOne / Virtualizor Enduser API

DMIT 暂无公开客户 API，后续可作为 agent 数据源接入。

## VPS 一键安装

在使用 systemd、Python 3.11+ 的 Linux VPS 上运行：

```bash
chmod +x scripts/install-vps.sh
sudo ./scripts/install-vps.sh
```

脚本会隐藏输入供应商凭据、执行首次设备发现，并启动定时采集与只读 API。生产文件统一为：

- `/etc/vpsmonitor/providers.yaml`：供应商配置；
- `/etc/vpsmonitor/secrets.env`：API Key、Token 和密码；
- `/var/lib/vpsmonitor/vpsmonitor.sqlite3`：监控数据库；
- `127.0.0.1:18787`：仅 VPS 本机可访问的 API。

重新输入供应商凭据时运行 `sudo ./scripts/install-vps.sh --reconfigure`。

## 源码开发

```bash
chmod +x scripts/configure.sh
./scripts/configure.sh
```

脚本会安装锁定依赖并隐藏输入所选供应商的凭据。配置默认保存在
`~/.config/vpsmonitor/providers.yaml`，凭据保存在
`~/.config/vpsmonitor/secrets.env`，权限均为 `0600`。项目根目录 `.env` 只用于兼容旧部署。

## 运行

单次采集：

```bash
uv run vpsmonitor collect
```

只采集某一家：

```bash
uv run vpsmonitor collect --provider aliyun_swas
```

持续运行：

```bash
uv run vpsmonitor run
```

当前配置默认每 5 分钟采集一次。供应商 API 的流量和监控数据通常不是秒级更新，过密轮询只会增加限流风险。

## 服务维护

一键安装后的 Python 环境位于 `/opt/vpsmonitor/venv`，常驻服务名为
`vpsmonitor-provider.service` 和 `vpsmonitor-api.service`。常用维护命令：

```bash
systemctl status vpsmonitor-provider
journalctl -u vpsmonitor-provider -n 100 --no-pager
systemctl restart vpsmonitor-provider
systemctl status vpsmonitor-api
journalctl -u vpsmonitor-api -n 100 --no-pager
```

服务以无特权的 `vpsmonitor` 系统用户运行，只有 `/var/lib/vpsmonitor` 可写；配置和凭据
权限为 `0640`，所有者为 `root:vpsmonitor`。

查看最新数据或导出 JSON：

```bash
uv run vpsmonitor status
uv run vpsmonitor export-json
```

生产数据库位于 `/var/lib/vpsmonitor/vpsmonitor.sqlite3`。每条 observation 只持久化规范化后的
`metrics`、`quota` 和 `metadata`；供应商返回的完整原始 JSON 不落盘。

初始默认保留 7 天的 5 分钟粒度监控曲线和 30 天的采集运行日志。清理历史时每台实例仍会
保留最后一条状态，因此长时间离线或已移除实例不会因清理而丢失身份信息。保留时间可在
Web 顶栏或 Mac 设置中随时调整，也可在首次初始化前通过
`storage.history_retention_days` 和 `storage.run_retention_days` 设置默认值。

## 监控 API

生产 API 只监听服务器的 `127.0.0.1:18787`，通过 SSH 隧道映射为本地
`127.0.0.1:8787`，供本地 Web/App 使用。完整契约见
[docs/API.md](docs/API.md)，交给 Claude 开发前端的提示词见
[docs/CLAUDE_WEB_PROMPT.md](docs/CLAUDE_WEB_PROMPT.md)。

本地开发启动：

```bash
uv run vpsmonitor-api
```

建立隧道后可以访问：

```text
http://127.0.0.1:8787/health
http://127.0.0.1:8787/docs
http://127.0.0.1:8787/openapi.json
```

实例总览只返回供应商最近一次成功采集仍存在的 VPS。已删除实例不会继续占用总览数量。
可通过 `/api/v1/instances?include_removed=true` 找回其最后状态；曲线历史同样按 7 天期限
清理。

缓存接口读取后台定时采集结果；`GET /api/v1/live/aliyun_swas` 则在每次请求时重新调用
阿里云 SWAS API，轮询间隔由 Web/App 决定。供应商 AccessKey 始终只保存在服务端。

## macOS 菜单栏应用

`macos/VPSMonitorMenuBar` 提供纯原生 SwiftUI 菜单栏客户端，支持 VPS 概览、详情、
历史趋势、导入多个只读监控源和拖拽排序；阿里云实时接口默认每 5 分钟查询，并可在
菜单中选择固定或自定义间隔。可选启用 CloudKit 私有库同步监控源、排序、别名和流量
重置偏好，支持手动同步、启动同步、每日同步和恢复网络后补同步。它默认连接本机 SSH 隧道
`http://127.0.0.1:8787`，不会接触供应商密钥或发送控制命令。首次启动时在原生设置中填写
VPS 安装脚本输出的 SSH 地址，应用随后会自动建立短生命周期隧道。

```bash
cd macos/VPSMonitorMenuBar
swift test
swift run VPSMonitorMenuBar
```

完整使用以及 `.app`、DMG 打包方式见
[macos/VPSMonitorMenuBar/README.md](macos/VPSMonitorMenuBar/README.md)。

## Web 界面

`web/` 是配套的本地监控面板（React + Vite + TypeScript）。监控数据只读，仅留存设置
使用 PUT；前端
不接触任何供应商凭据。配置 `web/.env.local` 后，Vite 可以随 Web 服务自动启停 SSH
隧道：

```bash
cd web
npm install
npm run dev
```

功能、扩展方式（新增 VPS / 新增供应商无需改代码）和数据处理约定见
[web/README.md](web/README.md)。

## 凭据安全

- 所有 API 调用都由后端发起，密钥不得进入浏览器前端。
- Panstar 必须选择 `read_only`。
- 阿里云使用 RAM 子用户的最小权限 AccessKey，不使用主账号 AccessKey。
- KiwiVM、RackNerd SolusVM、GreenCloud 和 Virtualizor Token 可能具有服务器控制权限，建议单独创建并定期轮换。
- 程序不会把带有密钥的请求 URL 写入日志。

## GreenCloud 与 Cloudflare

GreenCloud 当前可能对 `https://cp.green.cloud/api/*` 返回 Cloudflare
JavaScript Challenge（HTTP 403 且响应头 `cf-mitigated: challenge`）。这是请求在到达
VirtFusion Bearer Token 认证前被供应商的 WAF 拦截，不是 Token 错误。

长期运行不应复制浏览器的 `cf_clearance` Cookie：它与客户端环境绑定、会过期，并且
Cloudflare 不支持用命令行工具或无头浏览器自动解决 Challenge。建议把采集器部署到有
固定公网 IP 的 VPS，然后请 GreenCloud 对该 IP 或 `/api/*` 配置 WAF Skip；解决后无需
修改采集器代码。
