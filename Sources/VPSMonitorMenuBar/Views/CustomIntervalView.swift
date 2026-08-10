import SwiftUI

struct CustomIntervalView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var value: Int
    @State private var unit: LiveIntervalUnit
    let onSave: (LiveRefreshSchedule) -> Void

    init(current: LiveRefreshSchedule, onSave: @escaping (LiveRefreshSchedule) -> Void) {
        let initial: (value: Int, unit: LiveIntervalUnit)
        if let value = current.customValue, let unit = current.customUnit {
            initial = (value, unit)
        } else if current.seconds.isMultiple(of: LiveIntervalUnit.days.multiplier) {
            initial = (current.seconds / LiveIntervalUnit.days.multiplier, .days)
        } else if current.seconds.isMultiple(of: LiveIntervalUnit.hours.multiplier) {
            initial = (current.seconds / LiveIntervalUnit.hours.multiplier, .hours)
        } else if current.seconds.isMultiple(of: LiveIntervalUnit.minutes.multiplier) {
            initial = (current.seconds / LiveIntervalUnit.minutes.multiplier, .minutes)
        } else {
            initial = (current.seconds, .seconds)
        }
        _value = State(initialValue: initial.value)
        _unit = State(initialValue: initial.unit)
        self.onSave = onSave
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("自定义刷新间隔")
                        .font(.title2.weight(.semibold))
                    Text("用于阿里云 SWAS 实时查询")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("取消") { dismiss() }
            }
            .padding(18)

            Divider()

            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 10) {
                    TextField("数值", value: $value, format: .number)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 110)
                    Picker("单位", selection: $unit) {
                        ForEach(LiveIntervalUnit.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 110)
                    Stepper("", value: $value, in: 1...9_999)
                        .labelsHidden()
                }

                Label("实际间隔：\(schedule.title)", systemImage: "timer")
                    .font(.subheadline.weight(.medium))

                if schedule.isAggressive {
                    Label("低于 30 秒会频繁触发多次阿里云上游请求，可能遇到限流。", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else {
                    Text("每次到期都会调用实时接口；历史曲线仍由服务器每 5 分钟采集。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)

            Spacer()
            Divider()

            HStack {
                Text("范围：1–9,999 秒 / 分钟 / 小时 / 天")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("应用") {
                    onSave(schedule)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }
            .padding(18)
        }
        .frame(width: 430, height: 300)
        .background(.ultraThinMaterial)
    }

    private var schedule: LiveRefreshSchedule {
        LiveRefreshSchedule(customValue: max(1, value), unit: unit)
    }
}
