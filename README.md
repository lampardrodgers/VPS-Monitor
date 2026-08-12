# VPS Monitor for macOS

一个纯原生 SwiftUI 菜单栏应用，对接
[`api` 分支](https://github.com/lampardrodgers/VPS-Monitor/blob/api/docs/API.md)定义的监控 API。

当前版本：`0.3.1`。

## 功能

- 点击菜单栏服务器图标查看全部 VPS、在线状态、CPU、内存、磁盘、网络和流量。
- 点击 VPS 查看实例资料、全部 API 字段与 24 小时 / 7 天 / 30 天历史趋势。
- 阿里云 SWAS 通过 `/api/v1/live/aliyun_swas` 实时刷新，默认每 5 分钟查询一次。
- 顶部时间菜单支持 5 秒、30 秒、1/5/10/30 分钟、1/6/12/24 小时及自定义数值和单位。
- 导入多个监控 API，默认连接 `http://127.0.0.1:8787`。
- 在排序模式中拖动 VPS 调整顺序，配置保存在本机。
- 缓存总览在菜单打开时每 60 秒刷新；阿里云实时轮询在菜单关闭后仍按所选间隔运行。
- 访问本机转发地址时，每轮刷新自动建立临时 SSH 隧道，API 请求完成后立即关闭。
- 实时查询失败时保留上次成功数据，连接失败也会明确提示。
- 设置窗口可调整服务器端曲线历史和采集日志的实际保留天数。
- 监控数据只发起只读 GET；仅留存设置使用 PUT，不读取供应商 Token，不实现控制命令。

## 开发运行

要求 macOS 14 或更高版本、Xcode 15 或更高版本。

```bash
swift test
swift run VPSMonitorMenuBar
```

也可以直接用 Xcode 打开 `Package.swift`。

## 构建应用

```bash
chmod +x scripts/build-app.sh
./scripts/build-app.sh
open "dist/VPS Monitor.app"
```

生成的应用使用 ad-hoc 签名，位于 `dist/VPS Monitor.app`。正式分发时可再配置 Developer ID 签名与公证。

## API 连接

生产 API 只监听远程服务器的 `127.0.0.1:18787`。把 SSH 参数保存在
`~/.config/vpsmonitor/web/.env.local`：

```bash
VPSMON_SSH_TARGET=root@<SERVER_IP>
VPSMON_SSH_LOCAL_PORT=8787
VPSMON_SSH_REMOTE_HOST=127.0.0.1
VPSMON_SSH_REMOTE_PORT=18787
# VPSMON_SSH_IDENTITY_FILE=~/.ssh/id_ed25519
```

应用会在刷新前运行一次短生命周期 SSH 端口转发，本轮普通/实时 API 请求全部结束后终止 SSH，不需要手动常驻隧道。应用不会把 API 或供应商服务暴露到公网。导入其他地址时，对方同样需要实现仓库 `docs/API.md` 中的接口。
