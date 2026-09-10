# VPS Monitor for macOS

一个纯原生 SwiftUI 菜单栏应用，对接
[`api` 分支](https://github.com/lampardrodgers/VPS-Monitor/blob/api/docs/API.md)定义的监控 API。

当前版本：`0.4.2`。

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
- 可选启用 iCloud 配置同步：支持手动同步、每次启动同步、每天本地 0 点同步和恢复网络后自动补同步；不同 Mac 的监控源按稳定身份取并集，重复源只保留一份。
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

默认生成的应用使用 ad-hoc 签名，位于 `dist/VPS Monitor.app`，可用于界面和本地功能测试；为避免 macOS 拒绝启动，默认构建不会嵌入 CloudKit 权限。
正式启用 iCloud 前，需要使用匹配的 Apple Developer provisioning profile 构建。

生成可拖入“应用程序”目录的 DMG：

```bash
./scripts/package-dmg.sh
```

DMG 默认位于 `dist/VPS Monitor 0.4.2.dmg`。正式分发时应设置 Developer ID 签名、
provisioning profile，并通过 `VPSMON_NOTARY_PROFILE` 提交 Apple 公证。
`package-release.sh` 会强制要求已配置公证凭据，避免生成未公证的正式发布包。

### 开机自动启动

在应用“设置 → 启动”中打开“登录时自动启动”。应用使用 macOS 原生登录项管理，
开关会同步到“系统设置 → 通用 → 登录项”。该功能要求从签名的 `.app` 或 DMG 安装后运行；
使用 `swift run` 调试时系统可能显示“当前运行方式不支持”。

### iCloud 同步配置

同步只保存用户配置，不上传监控历史、本地缓存、SSH 私钥或供应商 Token。配置包括监控源、启用状态、VPS 排序、别名、国家覆盖和流量重置偏好。

要真正启用 CloudKit，需要使用自己的 Apple Developer 账号完成一次配置：

1. 在 Apple Developer 后台创建或确认 App ID
   `com.lampardrodgers.vpsmonitor.menubar`，并开启 iCloud/CloudKit。
2. 创建同名容器 `iCloud.com.lampardrodgers.vpsmonitor.menubar`。
3. 在 CloudKit Dashboard 的 Development 环境运行一次 App，让 `VPSMonitorPreferences` 记录类型自动建立；发布前把 schema 部署到 Production。
4. 使用该 App ID 对应用进行开发签名、Developer ID 签名或 Mac App Store 签名。当前脚本的 ad-hoc 签名只能用于界面和本地功能测试，不能代表 CloudKit 已经可用；使用非 ad-hoc 身份时，同时设置 `VPSMON_PROVISIONING_PROFILE` 指向匹配的 macOS profile。

应用启用同步后：

- 启动时同步一次。
- 每天按 Mac 本地时间过了 0 点后同步一次。
- 断网时保留本地修改，不反复弹窗；恢复网络后自动补同步。
- 手动点击“立即同步”可以立刻执行一次。
- 首次同步按监控源和实例稳定 ID 合并，新增项取并集；同一项的配置按最近修改时间处理。

每台 Mac 仍需各自准备 SSH Key。iCloud 只同步 API 地址和应用设置，不会自动复制另一台 Mac 的 SSH 私钥。

## API 连接

生产 API 只监听远程服务器的 `127.0.0.1:18787`。首次启动应用会自动打开设置，在
“VPS 连接”中填写 VPS 安装脚本输出的 SSH 地址，并可选指定私钥路径。配置保存在
`~/.config/vpsmonitor/macos/connection.env`。

也可以手动创建该文件：

```bash
VPSMON_SSH_TARGET=root@<SERVER_IP>
VPSMON_SSH_LOCAL_PORT=8787
VPSMON_SSH_REMOTE_HOST=127.0.0.1
VPSMON_SSH_REMOTE_PORT=18787
# VPSMON_SSH_IDENTITY_FILE=~/.ssh/id_ed25519
```

应用会在刷新前运行一次短生命周期 SSH 端口转发，本轮普通/实时 API 请求全部结束后终止 SSH，不需要手动常驻隧道。应用不会把 API 或供应商服务暴露到公网。导入其他地址时，对方同样需要实现仓库 `docs/API.md` 中的接口。
