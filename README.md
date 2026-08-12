# VPS Monitor API

VPS Monitor 的只读采集与查询服务。它从多家 VPS 供应商 API 采集数据，写入本地
SQLite，并向 [`mac`](https://github.com/lampardrodgers/VPS-Monitor/tree/mac) 与
[`web`](https://github.com/lampardrodgers/VPS-Monitor/tree/web) 客户端提供统一接口。

当前版本：`0.3.1`。

## 一键配置

要求 Python 3.11+ 和 [uv](https://docs.astral.sh/uv/)。克隆 `api` 分支后运行：

```bash
chmod +x scripts/configure.sh
./scripts/configure.sh
```

脚本会安装锁定依赖、逐项询问需要启用的供应商，并用隐藏输入读取凭据。生成结果位于
源码目录之外：

- `~/.config/vpsmonitor/providers.yaml`：供应商与实例配置，权限 `0600`；
- `~/.config/vpsmonitor/secrets.env`：API Key、Token 和密码，权限 `0600`；
- `~/.local/share/vpsmonitor/vpsmonitor.sqlite3`：运行后生成的数据库。

配置文件只保存环境变量引用，明文凭据不会写入 YAML，也不会进入 Git。重新配置时使用
`./scripts/configure.sh --force`，脚本会在收集完全部输入后原子替换配置。

## 运行

```bash
uv run vpsmonitor doctor
uv run vpsmonitor collect
uv run vpsmonitor run
uv run vpsmonitor-api
```

API 默认仅监听 `127.0.0.1:8787`。服务会拒绝非回环监听；远程客户端应通过 SSH 隧道访问：

```bash
ssh -N -L 8787:127.0.0.1:8787 user@<SERVER_IP>
```

实时阿里云接口在服务端至少 30 秒复用一次结果，并合并并发请求，避免客户端轮询放大为
大量供应商 API 调用。完整接口见 [docs/API.md](docs/API.md)。

## 支持的供应商

- BandwagonHost / KiwiVM
- 阿里云轻量应用服务器 SWAS
- PanstarCloud API V1
- GreenCloud / VirtFusion
- DediOne / Virtualizor

## 安全约束

- 只允许通过 `env` 引用凭据，配置加载器拒绝 YAML 明文密钥；
- API 只允许回环监听，不要将端口直接暴露到公网；
- Web 与 macOS 客户端不接触供应商凭据；
- 发布分支不包含本地配置、环境文件、数据库、构建产物或真实基础设施截图；
- 使用供应商提供的只读、最小权限凭据，并定期轮换。

## 分支

- `old-version`：原 `main` 的 v0.1.0 历史版本；
- `api`：本项目；
- `web`：React/Vite 客户端；
- `mac`：原生 SwiftUI 菜单栏客户端。
