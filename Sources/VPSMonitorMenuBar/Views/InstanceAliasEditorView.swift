import SwiftUI

struct InstanceAliasEditorView: View {
    let instance: MonitoredInstance
    @ObservedObject var store: MonitorStore
    let onClose: () -> Void
    @State private var alias: String

    init(instance: MonitoredInstance, store: MonitorStore, onClose: @escaping () -> Void) {
        self.instance = instance
        self.store = store
        self.onClose = onClose
        _alias = State(initialValue: store.alias(for: instance) ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("设置 VPS 备注名")
                    .font(.headline)
                Text("原名称：\(instance.observation.displayName)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            TextField("例如：香港中转", text: $alias)
                .textFieldStyle(.roundedBorder)
                .onSubmit(save)

            Text("设置后，列表和详情页将优先显示备注名；原名称仍保留在实例信息中。")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                if store.alias(for: instance) != nil {
                    Button("清除备注") {
                        store.setAlias(nil, for: instance)
                        onClose()
                    }
                }
                Spacer()
                Button("取消", action: onClose)
                    .keyboardShortcut(.cancelAction)
                Button("保存", action: save)
                    .keyboardShortcut(.defaultAction)
                    .disabled(alias.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.accentColor.opacity(0.28), lineWidth: 1)
        }
    }

    private func save() {
        let trimmed = alias.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        store.setAlias(trimmed, for: instance)
        onClose()
    }
}
