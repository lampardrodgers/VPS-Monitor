import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: MonitorStore
    @State private var isImporting = false
    @State private var sourceToDelete: MonitorSource?
    @State private var retentionSourceID: UUID?
    @State private var historyRetentionDays = 7
    @State private var runRetentionDays = 30
    @State private var isLoadingRetention = false
    @State private var isSavingRetention = false
    @State private var retentionError: String?
    @State private var sshTarget = ""
    @State private var sshRemotePort = String(SSHTunnelConfiguration.defaultRemotePort)
    @State private var sshIdentityFile = ""
    @State private var isTestingSSH = false
    @State private var sshConnectionMessage: String?
    @State private var sshConnectionSucceeded = false
    @State private var launchAtLoginEnabled = false
    @State private var isUpdatingLaunchAtLogin = false
    @State private var launchAtLoginMessage: String?

    var body: some View {
        Form {
            Section("iCloud 同步") {
                Toggle("启用自动同步", isOn: Binding(
                    get: { store.cloudSyncEnabled },
                    set: { store.setCloudSyncEnabled($0) }
                ))

                HStack(spacing: 8) {
                    Label(store.cloudSyncStatus.title, systemImage: store.cloudSyncStatus.systemImage)
                    Spacer()
                    if store.cloudSyncStatus == .syncing {
                        ProgressView().controlSize(.small)
                    }
                    Button("立即同步") {
                        Task { await store.syncCloudPreferencesNow() }
                    }
                    .disabled(!store.cloudSyncEnabled || store.cloudSyncStatus == .syncing)
                }

                if let lastCloudSyncAt = store.lastCloudSyncAt {
                    Text("上次同步：\(lastCloudSyncAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let cloudSyncSummary = store.cloudSyncSummary {
                    Text(cloudSyncSummary.text)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let detail = store.cloudSyncStatus.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .lineLimit(2)
                }

                Text("启用后会在每次打开 App、每天本地 0 点以及恢复网络时自动同步。断网期间继续使用本地设置，联网后自动补同步。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("监控源") {
                ForEach(store.sources) { source in
                    HStack(spacing: 10) {
                        Image(systemName: "externaldrive.connected.to.line.below")
                            .foregroundStyle(source.isEnabled ? Color.accentColor : Color.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(source.name)
                            Text(source.normalizedBaseURL)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                        Spacer()
                        Toggle("启用", isOn: Binding(
                            get: { source.isEnabled },
                            set: { store.setSource(source, enabled: $0) }
                        ))
                        .labelsHidden()
                        Button(role: .destructive) {
                            sourceToDelete = source
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                    }
                    .padding(.vertical, 4)
                }
                Button("导入监控源…", systemImage: "plus") {
                    isImporting = true
                }
            }

            Section("VPS 连接") {
                TextField("SSH 地址", text: $sshTarget, prompt: Text("root@203.0.113.10"))
                    .textContentType(.URL)
                TextField("远端 API 端口", text: $sshRemotePort)
                TextField("SSH 私钥（可选）", text: $sshIdentityFile, prompt: Text("~/.ssh/id_ed25519"))

                HStack {
                    if isTestingSSH {
                        ProgressView().controlSize(.small)
                    }
                    if let sshConnectionMessage {
                        Label(
                            sshConnectionMessage,
                            systemImage: sshConnectionSucceeded ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
                        )
                        .font(.caption)
                        .foregroundStyle(sshConnectionSucceeded ? Color.green : Color.red)
                        .lineLimit(2)
                    }
                    Spacer()
                    Button("保存并测试") {
                        Task { await saveAndTestSSHConnection() }
                    }
                    .disabled(isTestingSSH || sshTarget.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                Text("使用 SSH Key 或系统 ssh-agent 登录。连接信息保存在 \(SSHTunnelConfiguration.storagePath)，供应商 API Key 始终只保存在 VPS。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            Section("启动") {
                Toggle("登录时自动启动", isOn: Binding(
                    get: { launchAtLoginEnabled },
                    set: { setLaunchAtLogin($0) }
                ))
                .disabled(isUpdatingLaunchAtLogin)

                if isUpdatingLaunchAtLogin {
                    ProgressView("正在更新登录项…")
                        .controlSize(.small)
                }
                if let launchAtLoginMessage {
                    Label(launchAtLoginMessage, systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .lineLimit(2)
                }
                Text("开启后，macOS 登录完成时会自动启动 VPS Monitor，并继续在菜单栏运行。状态由 macOS 系统设置管理。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("刷新") {
                LabeledContent("自动刷新", value: "菜单打开时每 60 秒")
                LabeledContent("SSH 连接", value: "每轮临时建立")
                Text("刷新开始时自动建立 SSH 端口转发，本轮 API 请求完成后立即关闭，不会在后台常驻。成功数据会缓存在本机，连接失败时继续展示。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("数据保留") {
                Picker("监控源", selection: $retentionSourceID) {
                    Text("选择监控源").tag(Optional<UUID>.none)
                    ForEach(store.sources) { source in
                        Text(source.name).tag(Optional(source.id))
                    }
                }

                Stepper(
                    "曲线历史：\(historyRetentionDays) 天",
                    value: $historyRetentionDays,
                    in: 1...3_650
                )
                Stepper(
                    "采集日志：\(runRetentionDays) 天",
                    value: $runRetentionDays,
                    in: 1...3_650
                )

                HStack {
                    if isLoadingRetention || isSavingRetention {
                        ProgressView().controlSize(.small)
                    }
                    if let retentionError {
                        Text(retentionError)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .lineLimit(2)
                    }
                    Spacer()
                    Button("保存到服务器") {
                        Task { await saveRetention() }
                    }
                    .disabled(selectedRetentionSource == nil || isLoadingRetention || isSavingRetention)
                }

                Text("缩短期限会立即删除服务器 SQLite 中的过期数据；之后再调大不能恢复已经删除的曲线。设置由服务器保存，Web 和 Mac 会共享同一结果。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("安全") {
                Label("监控数据只读；仅留存设置发送 PUT，不包含关机、重启或重装操作。", systemImage: "lock.shield")
                    .font(.caption)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .frame(width: 560, height: 760)
        .background(.ultraThinMaterial)
        .sheet(isPresented: $isImporting) {
            ImportSourceView(store: store)
        }
        .confirmationDialog(
            "移除“\(sourceToDelete?.name ?? "")”？",
            isPresented: Binding(
                get: { sourceToDelete != nil },
                set: { if !$0 { sourceToDelete = nil } }
            )
        ) {
            Button("移除监控源", role: .destructive) {
                if let sourceToDelete { store.removeSource(sourceToDelete) }
                sourceToDelete = nil
            }
            Button("取消", role: .cancel) { sourceToDelete = nil }
        } message: {
            Text("只会移除本机菜单栏中的连接和缓存，不会删除服务器数据。")
        }
        .task {
            loadSSHConnection()
            loadLaunchAtLoginState()
            if retentionSourceID == nil {
                retentionSourceID = store.sources.first?.id
            }
            await loadRetention()
        }
        .onChange(of: retentionSourceID) {
            Task { await loadRetention() }
        }
    }

    private func loadSSHConnection() {
        guard let configuration = SSHTunnelConfiguration.load() else { return }
        sshTarget = configuration.target
        sshRemotePort = String(configuration.remotePort)
        sshIdentityFile = configuration.identityFile ?? ""
    }

    private func loadLaunchAtLoginState() {
        launchAtLoginEnabled = LaunchAtLogin.isEnabled
        launchAtLoginMessage = LaunchAtLogin.statusMessage
    }

    private func setLaunchAtLogin(_ enabled: Bool) {
        guard !isUpdatingLaunchAtLogin else { return }
        isUpdatingLaunchAtLogin = true
        launchAtLoginMessage = nil
        Task { @MainActor in
            defer { isUpdatingLaunchAtLogin = false }
            do {
                try LaunchAtLogin.setEnabled(enabled)
                loadLaunchAtLoginState()
            } catch {
                launchAtLoginEnabled = LaunchAtLogin.isEnabled
                launchAtLoginMessage = "无法更新登录项：\(error.localizedDescription)"
            }
        }
    }

    @MainActor
    private func saveAndTestSSHConnection() async {
        isTestingSSH = true
        sshConnectionMessage = nil
        sshConnectionSucceeded = false
        defer { isTestingSSH = false }
        do {
            guard let port = Int(sshRemotePort), (1...65_535).contains(port) else {
                throw SSHTunnelConfigurationError.invalidRemotePort
            }
            try SSHTunnelConfiguration.save(
                target: sshTarget,
                remotePort: port,
                identityFile: sshIdentityFile
            )
            try await store.testDefaultSSHConnection()
            sshConnectionSucceeded = true
            sshConnectionMessage = "连接成功"
            await store.refreshAll()
        } catch {
            sshConnectionMessage = error.localizedDescription
        }
    }

    private var selectedRetentionSource: MonitorSource? {
        guard let retentionSourceID else { return nil }
        return store.sources.first { $0.id == retentionSourceID }
    }

    @MainActor
    private func loadRetention() async {
        guard let source = selectedRetentionSource else { return }
        isLoadingRetention = true
        retentionError = nil
        defer { isLoadingRetention = false }
        do {
            let value = try await store.fetchRetentionSettings(for: source)
            historyRetentionDays = value.historyRetentionDays
            runRetentionDays = value.runRetentionDays
        } catch {
            retentionError = error.localizedDescription
        }
    }

    @MainActor
    private func saveRetention() async {
        guard let source = selectedRetentionSource else { return }
        isSavingRetention = true
        retentionError = nil
        defer { isSavingRetention = false }
        do {
            let value = try await store.updateRetentionSettings(
                for: source,
                historyDays: historyRetentionDays,
                runDays: runRetentionDays
            )
            historyRetentionDays = value.historyRetentionDays
            runRetentionDays = value.runRetentionDays
        } catch {
            retentionError = error.localizedDescription
        }
    }
}
