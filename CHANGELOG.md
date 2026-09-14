# Changelog

## Unreleased

## mac-v0.4.9 - 2026-09-14

- 将 macOS 源码与发布恢复至独立 `mac` 分支；打包脚本默认从该分支根目录读取签名描述文件。

- 缩小详情页返回按钮与运行状态之间的间距。

## mac-v0.4.8 - 2026-09-14

- 移除详情页返回按钮与服务器信息之间的分隔线。

## mac-v0.4.7 - 2026-09-14

- 固定详情页完整顶部信息区，包括返回、状态、更新时间、名称和供应商信息；编辑备注或国家时自动滚动到编辑区域。

## mac-v0.4.6 - 2026-09-14

- 将详情页“返回所有 VPS”移入固定顶部导航区，下方内容滚动时返回按钮始终可用。

## mac-v0.4.5 - 2026-09-14

- 为流量消耗分析增加独立的 24 小时 / 7 天 / 30 天切换；时间范围、加载状态及重试与使用率趋势互不影响。

## mac-v0.4.4 - 2026-09-14

- 隐藏首页和详情页滚动指示条，保留原生滚动操作，去除深色面板边缘的高亮竖条。
- 修正使用率趋势时间轴：24 小时显示 24 小时制时间，7 天和 30 天显示月/日，并固定所选时间范围。
- 新增流量消耗分析：按小时/天展示累计用量增量、记录总量、有效时段日均、最高记录时段和可选择的柱状数据。
- 排除重置、计数回退、缺失和长间断区间，明确显示采样覆盖与估算口径。
- 扩大 7 天历史请求上限，防止五分钟采样被截断；修正切换时间范围时旧请求覆盖新图表的问题。

## mac-v0.4.3 - 2026-09-11

- Fixed the right-click menu bar context menu opening scrolled with the first item hidden behind a scroll-up indicator; the menu is now presented natively below the status item.

## mac-v0.4.2 - 2026-09-10

- Added a native menu bar context menu for Settings, launch at login, refresh intervals, immediate refresh, and quitting.
- Improved first-run Settings opening through the SwiftUI Settings action and refreshed login-item status when the app becomes active.
- Added a standalone custom refresh interval window with consistent apply and cancel behavior.
- Refined the server list scrollbar with a subtle overlay appearance while preserving native scrolling and accessibility contrast.

## mac-v0.4.1 - 2026-09-02

- Added the native login-at-startup setting backed by macOS ServiceManagement.
- Added explicit notarization requirements for formal DMG releases.

## mac-v0.4.0 - 2026-08-22

- Added native first-run VPS SSH configuration and a save-and-test connection flow.
- Added automatic SSH host-key enrollment for unattended short-lived tunnels.
- Added signed DMG packaging with optional Apple notarization and stapling.

## mac-v0.3.1 - 2026-08-12

- Added a native status-bar panel with remembered, resizable dimensions.
- Added status/provider visibility filters for the main VPS list.
- Added masked IP address display with explicit reveal and copy actions.
- Replaced release test fixtures with documentation-only IP ranges.

## mac-v0.3.0 - 2026-08-11

- Added shared server retention settings to the native Settings window.
- Added RackNerd provider presentation metadata.
- Added short-lived SSH tunnels that are opened for refresh requests and closed immediately afterward.
- Added the release application icon and updated bundle metadata.

## mac-v0.2.0 - 2026-08-10

- Published the native SwiftUI menu bar client as a standalone branch.
- Added multi-source import, instance detail/history views, ordering, aliases, and refresh controls.
- Kept provider credentials server-side and defaulted connections to the local SSH tunnel.
- Replaced account-derived test data with synthetic fixtures and excluded private screenshots/builds.
