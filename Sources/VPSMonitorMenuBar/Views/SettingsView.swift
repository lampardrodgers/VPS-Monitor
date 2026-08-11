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

    var body: some View {
        Form {
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

            Section("刷新") {
                LabeledContent("自动刷新", value: "菜单打开时每 60 秒")
                LabeledContent("SSH 连接", value: "每轮临时建立")
                Text("刷新开始时自动建立 SSH 端口转发，本轮 API 请求完成后立即关闭，不会在后台常驻。成功数据会缓存在本机，连接失败时继续展示。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("数据保留") {
                Picker("监控源", selection: $retentionSourceID) {
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
        .frame(width: 530, height: 590)
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
            if retentionSourceID == nil {
                retentionSourceID = store.sources.first?.id
            }
            await loadRetention()
        }
        .onChange(of: retentionSourceID) {
            Task { await loadRetention() }
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
