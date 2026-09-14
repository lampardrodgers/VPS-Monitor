# 项目协作说明

## 分支与发布规则

- 各模块独立维护：macOS App 的所有代码、文档和版本发布放在 `mac` 分支；Web 放在 `web` 分支；API、采集器及服务端部署脚本放在 `api` 分支。
- `main` 仅用于项目介绍、模块导航和仓库协作规则，不放模块源码或构建产物。此规则优先于通用的默认发布到 main 规则。
- 发布前确认目标分支；使用独立 worktree 处理各模块，不将其他模块合并进目标分支。
- Tag 分别使用 `mac-v<版本号>`、`web-v<版本号>`、`api-v<版本号>`，Tag 必须指向对应模块分支的发布提交；版本号、更新日志与 Release 保持一致。
- 使用 GitHub 账号 `lampardrodgers`，提交邮箱 `sunjh42a3@163.com`。
- 遇到冲突、历史分叉或远端覆盖风险，暂停并确认，不擅自解决或强推。
- 密码、Token、私钥、签名凭据和本地配置不得提交到 Git。
- macOS 版本更新时必须更新本地 App 并保留用户配置；GitHub 发布同时上传完成 Developer ID 签名、Apple 公证、票据装订及 Gatekeeper 验证的同版本 DMG。

## macOS 更新与 GitHub 发布

- 分支按模块隔离：所有 macOS App 代码和版本发布必须进入 `mac` 分支；Web 使用 `web` 分支，API 使用 `api` 分支。macOS 发布不得使用 `main` 或 `web`，此规则优先于通用的默认 `main` 规则。
- macOS 发布 Tag 使用 `mac-v<版本号>`，对应 GitHub Release 必须指向 `mac` 分支上的发布提交并附带同版本 DMG。
- macOS App 版本有更新时，必须构建并更新本地 App，退出旧进程后安装、启动新版本，保留现有用户配置。
- 上传或发布包含 macOS 更新的版本到 GitHub 时，必须同时通过下述正式一键打包入口生成对应版本的新 DMG，完成签名、公证、装订及最终验证，并将 DMG 上传至对应的 GitHub Release。
- App 版本号、Git Tag、更新日志、DMG 文件名及 GitHub Release 版本必须一致；不得只上传源码而遗漏新 DMG。

## macOS 正式 DMG 签名与公证

- 正式分发的 macOS 安装包必须依次完成 Developer ID 签名、Apple 公证（notarization）和票据装订（stapling），不能只生成未公证的 DMG。
- 本项目的正式一键打包入口是：

  ```sh
  # 在 mac 分支工作目录根目录运行
  ./scripts/package-release.sh
  ```

- 当前项目默认使用以下发布配置，并允许通过同名环境变量覆盖：
  - Developer ID：`Developer ID Application: Jiehao Sun (SYL39J56SB)`
  - Team ID：`SYL39J56SB`
  - Developer ID Provisioning Profile：仓库根目录的 `VPS_Monitor_macOS_Developer_ID_CloudKit.provisionprofile`
  - CloudKit 环境：`Production`
  - Hardened Runtime：开启
  - notarytool Keychain Profile：`vpsmonitor-notary`
- App 专用密码已经通过 `xcrun notarytool store-credentials` 存入当前 Mac 的 Keychain。任何密码、App 专用密码或私钥都不得写入 AGENTS.md、脚本、`.env`、日志或 Git。
- Keychain Profile 是本机配置，不会随仓库复制到其他 Mac。换机器、凭据被撤销或失效时，需要在目标 Mac 重新执行：

  ```sh
  xcrun notarytool store-credentials "vpsmonitor-notary" \
    --apple-id "<Apple Account>" \
    --team-id "SYL39J56SB"
  ```

- 打包成功必须看到 Apple 返回 `Accepted`，并确认 stapling 成功。最终验证命令：

  ```sh
  xcrun stapler validate "dist/VPS Monitor <版本号>.dmg"
  spctl -a -vv -t open --context context:primary-signature \
    "dist/VPS Monitor <版本号>.dmg"
  ```

- Gatekeeper 验证结果必须包含 `accepted` 和 `source=Notarized Developer ID`，否则不得将该 DMG 作为正式版本分发。
- 2026-09-02 已成功公证并装订 `VPS Monitor 0.4.1.dmg`；Apple 提交编号为 `9b9a3487-ec52-4f6e-b0cc-cdae3137ef14`。
