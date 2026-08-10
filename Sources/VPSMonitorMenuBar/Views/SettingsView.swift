import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: MonitorStore
    @State private var isImporting = false
    @State private var sourceToDelete: MonitorSource?

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
                Text("窗口关闭后暂停轮询，再次打开菜单会立即刷新。成功数据会缓存在本机，用于隧道断开时继续展示。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("安全") {
                Label("仅发送只读 GET 请求，不包含关机、重启或重装操作。", systemImage: "lock.shield")
                    .font(.caption)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .frame(width: 530, height: 430)
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
    }
}
