# VPS Monitor

VPS 监控项目，提供服务端采集与 API、原生 macOS 菜单栏 App 和 Web 监控面板。

## 模块导航

| 分支 | 内容 | 使用说明 |
| --- | --- | --- |
| [`mac`](https://github.com/lampardrodgers/VPS-Monitor/tree/mac) | 原生 macOS App、签名及公证打包脚本 | [macOS 文档](https://github.com/lampardrodgers/VPS-Monitor/blob/mac/README.md) |
| [`web`](https://github.com/lampardrodgers/VPS-Monitor/tree/web) | React + Vite Web 监控面板 | [Web 文档](https://github.com/lampardrodgers/VPS-Monitor/blob/web/README.md) |
| [`api`](https://github.com/lampardrodgers/VPS-Monitor/tree/api) | VPS 采集器、API、一键安装与服务端部署 | [API 文档](https://github.com/lampardrodgers/VPS-Monitor/blob/api/README.md) |
| `main` | 项目介绍与导航 | 不存放模块源码 |
| [`old-version`](https://github.com/lampardrodgers/VPS-Monitor/tree/old-version) | 历史归档 | 保留旧版本 |

## 下载与版本

前往 [Releases](https://github.com/lampardrodgers/VPS-Monitor/releases) 下载。
macOS、Web、API 分别使用 `mac-v…`、`web-v…`、`api-v…` Tag，独立发布。
macOS 正式 DMG 完成 Developer ID 签名、Apple 公证和票据装订。

## 开发

请克隆对应模块分支，例如：

```sh
git clone --branch mac --single-branch https://github.com/lampardrodgers/VPS-Monitor.git vpsmonitor-mac
```

服务端保存供应商凭据，客户端通过监控 API 获取数据。安装、配置与开发命令见各模块文档。

## 分支整理

2026-09-14 已将先前集中在 main 的模块内容恢复至各自分支。main 不再维护模块源码；旧提交和旧发布记录保留以供追溯，新版本在对应模块分支发布。
