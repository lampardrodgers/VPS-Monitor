import SwiftUI

struct ResetTimeEditorView: View {
    let instance: MonitoredInstance
    @ObservedObject var store: MonitorStore
    let onClose: () -> Void
    @State private var selectedDate: Date
    @State private var autoAdvance: Bool

    init(instance: MonitoredInstance, store: MonitorStore, onClose: @escaping () -> Void) {
        self.instance = instance
        self.store = store
        self.onClose = onClose
        _selectedDate = State(initialValue: store.effectiveResetTime(for: instance) ?? .now)
        _autoAdvance = State(initialValue: store.isResetAutoAdvanceEnabled(for: instance))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("设置流量重置时间")
                    .font(.headline)
                Text(store.displayName(for: instance))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            DatePicker(
                "日期与时间",
                selection: $selectedDate,
                displayedComponents: [.date, .hourAndMinute]
            )
            .datePickerStyle(.field)

            Toggle("到期后自动顺延一个月", isOn: $autoAdvance)

            Text("启用后会使用下个月的同一日期与时间，不按固定 30 天计算。若下个月没有该日期，则使用当月最后一天；之后仍按最初选择的日期顺延。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Label("按本机时区保存，精确到分钟。此设置只保存在本机，不会修改服务器数据。", systemImage: "info.circle")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                if store.manualResetTime(for: instance) != nil {
                    Button("使用供应商时间") {
                        store.setManualResetTime(nil, for: instance)
                        onClose()
                    }
                    .help("清除手动设置；供应商未返回时间时将显示未设置")
                }
                Spacer()
                Button("取消", action: onClose)
                    .keyboardShortcut(.cancelAction)
                Button("保存") {
                    store.setManualResetTime(selectedDate, for: instance)
                    store.setResetAutoAdvanceEnabled(autoAdvance, for: instance)
                    onClose()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.accentColor.opacity(0.28), lineWidth: 1)
        }
    }
}
