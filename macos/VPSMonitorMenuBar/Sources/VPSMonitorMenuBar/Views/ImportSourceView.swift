import SwiftUI

struct ImportSourceView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: MonitorStore
    @State private var name = ""
    @State private var baseURL = "http://127.0.0.1:8787"
    @State private var isImporting = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("导入 VPS")
                        .font(.title2.weight(.semibold))
                    Text("连接一个符合 API.md 的只读监控源")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("取消") { dismiss() }
            }
            .padding(18)

            Divider()

            Form {
                Section {
                    TextField("名称", text: $name, prompt: Text("例如：香港节点"))
                    TextField("API 地址", text: $baseURL)
                } header: {
                    Text("监控源")
                } footer: {
                    Text("应用会读取 /health、/summary、/providers、/instances 和历史接口。不会连接供应商 API，也不会保存 Token。")
                }

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)

            Divider()
            HStack {
                Label("发现的所有 VPS 会自动加入菜单栏", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    importSource()
                } label: {
                    if isImporting {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("测试并导入")
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isImporting || baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(18)
        }
        .frame(width: 470, height: 350)
        .background(.ultraThinMaterial)
    }

    private func importSource() {
        isImporting = true
        errorMessage = nil
        Task {
            do {
                try await store.addSource(name: name, baseURL: baseURL)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isImporting = false
            }
        }
    }
}
