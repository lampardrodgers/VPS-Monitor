import Charts
import SwiftUI

struct ServerDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let instance: MonitoredInstance
    @ObservedObject var store: MonitorStore
    @State private var isEditingResetTime = false
    @State private var isEditingAlias = false
    @State private var isSelectingCountry = false

    private var current: MonitoredInstance {
        store.instances.first(where: { $0.id == instance.id }) ?? instance
    }

    private var server: InstanceObservation { current.observation }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Button {
                    dismiss()
                } label: {
                    Label("返回所有 VPS", systemImage: "chevron.left")
                }
                .buttonStyle(.plain)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.accentColor)
                identity
                if isEditingAlias {
                    InstanceAliasEditorView(instance: current, store: store) {
                        isEditingAlias = false
                    }
                }
                if isSelectingCountry {
                    CountryPickerInlineView(instance: current, store: store) {
                        isSelectingCountry = false
                    }
                }
                resourceGrid
                trafficCard
                if isEditingResetTime {
                    ResetTimeEditorView(instance: current, store: store) {
                        isEditingResetTime = false
                    }
                }
                HistoryChartView(instance: current, store: store)
                details
                rawValues
            }
            .padding(14)
        }
        .frame(width: 430, height: 610)
        .background {
            VisualEffectBackground(material: .underWindowBackground)
                .ignoresSafeArea()
        }
        .navigationTitle(store.displayName(for: current))
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                StatusBadge(state: server.normalizedState, raw: server.status)
                if server.isStale {
                    Label("数据陈旧", systemImage: "clock.badge.exclamationmark")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
                Spacer()
                Text(VPSFormat.relative(server.observedAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Button {
                    isSelectingCountry.toggle()
                    isEditingAlias = false
                    isEditingResetTime = false
                } label: {
                    if let countryCode = store.effectiveCountryCode(for: current) {
                        Text(CountryCatalog.flag(for: countryCode))
                            .font(.title2)
                    } else {
                        Image(systemName: "flag")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
                .frame(width: 31, height: 28)
                .contentShape(Rectangle())
                .help(store.effectiveCountryCode(for: current) == nil ? "选择国家或地区" : "修改国家或地区")

                Text(store.displayName(for: current))
                    .font(.title2.weight(.semibold))
                Button {
                    isEditingAlias.toggle()
                    isSelectingCountry = false
                    isEditingResetTime = false
                } label: {
                    Image(systemName: "pencil")
                }
                .buttonStyle(.borderless)
                .help(store.alias(for: current) == nil ? "添加备注名" : "修改备注名")
            }
            Text("\(server.providerDisplayName) · \(current.source.name)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var resourceGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            MetricTile(title: "CPU", value: VPSFormat.percent(server.metric("cpu_percent")), detail: cpuDetail, symbol: "cpu")
            MetricTile(title: "内存", value: VPSFormat.percent(server.memoryPercent), detail: usageDetail(server.memoryUsed, server.metric("memory_total_bytes")), symbol: "memorychip")
            MetricTile(title: "磁盘", value: VPSFormat.percent(server.diskPercent), detail: usageDetail(server.metric("disk_used_bytes"), server.metric("disk_total_bytes")), symbol: "internaldrive")
            MetricTile(title: "网络", value: VPSFormat.bitrate(server.metric("network_in_bps")), detail: "上传 \(VPSFormat.bitrate(server.metric("network_out_bps")))", symbol: "network")
        }
    }

    private var trafficCard: some View {
        SectionCard(title: "周期流量", symbol: "arrow.up.arrow.down") {
            if server.quota["traffic_unlimited"]?.bool == true {
                HStack {
                    Text("无限流量 / 带宽型")
                        .font(.headline)
                    Spacer()
                    Image(systemName: "infinity")
                        .foregroundStyle(.blue)
                }
            } else if let used = server.quotaNumber("traffic_used_bytes"), let total = server.quotaNumber("traffic_total_bytes"), total > 0 {
                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text("已使用 \(VPSFormat.bytes(used))")
                            .font(.subheadline.monospacedDigit())
                        Spacer()
                        Text(VPSFormat.percent(server.trafficPercent))
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                    }
                    Text("总额度 \(VPSFormat.bytes(total)) · 剩余 \(VPSFormat.bytes(max(0, total - used)))")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    TrafficProgressBar(progress: min(1, used / total), color: trafficColor)
                }
            } else if let used = server.quotaNumber("traffic_used_bytes") {
                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text("已使用 \(VPSFormat.bytes(used))")
                            .font(.headline.monospacedDigit())
                        Spacer()
                        Text("总额度未提供")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.blue)
                    }
                    TrafficProgressBar(
                        progress: 1,
                        color: .blue,
                        accessibilityText: "已获得用量数据，总额度未提供"
                    )
                    Text("蓝条表示已获得用量数据，不代表配额已使用 100%。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("此供应商未提供流量数据")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Divider()
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("重置时间")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(resetTime)
                        .font(.subheadline.monospacedDigit())
                    Text(resetTimeSource)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
                Button(store.manualResetTime(for: current) == nil ? "设置" : "修改") {
                    isEditingResetTime.toggle()
                    isEditingAlias = false
                    isSelectingCountry = false
                }
            }
        }
    }

    private var details: some View {
        SectionCard(title: "实例信息", symbol: "info.circle") {
            VStack(spacing: 8) {
                if store.alias(for: current) != nil {
                    DetailRow(label: "原名称", value: server.displayName)
                }
                DetailRow(label: "实例标识", value: server.instanceKey)
                DetailRow(label: "区域", value: server.metadataText("region", "location", "datacenter", "node") ?? VPSFormat.empty)
                DetailRow(label: "系统", value: server.metadataText("os", "os_name", "template", "operating_system") ?? VPSFormat.empty)
                DetailRow(label: "套餐", value: server.metadataText("plan_name", "plan_id", "package", "product") ?? VPSFormat.empty)
                DetailRow(label: "到期时间", value: server.metadataText("expires_at", "expire_at", "expiry", "due_date") ?? VPSFormat.empty)
                DetailRow(label: "采集时间", value: VPSFormat.date(server.observedAt)?.formatted(date: .numeric, time: .standard) ?? VPSFormat.empty)
            }
        }
    }

    private var rawValues: some View {
        DisclosureGroup("全部可用字段") {
            VStack(spacing: 7) {
                ForEach(server.metrics.keys.sorted(), id: \.self) { key in
                    DetailRow(label: key, value: display(server.metrics[key]))
                }
                ForEach(server.quota.keys.sorted(), id: \.self) { key in
                    DetailRow(label: key, value: display(server.quota[key]))
                }
                ForEach(server.metadata.keys.sorted(), id: \.self) { key in
                    DetailRow(label: key, value: display(server.metadata[key]))
                }
            }
            .padding(.top, 8)
        }
        .font(.subheadline)
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private var cpuDetail: String {
        if let load = server.metric("load_average") {
            return "负载 \(load.formatted(.number.precision(.fractionLength(2))))"
        }
        return "当前使用率"
    }

    private var trafficColor: Color {
        guard let percent = server.trafficPercent else { return .accentColor }
        if percent >= 95 { return .red }
        if percent >= 80 { return .orange }
        return .accentColor
    }

    private var resetTime: String {
        guard let date = store.effectiveResetTime(for: current) else {
            return "未设置"
        }
        return date.formatted(.dateTime.year().month(.twoDigits).day(.twoDigits).hour().minute())
    }

    private var resetTimeSource: String {
        if store.manualResetTime(for: current) != nil {
            return store.isResetAutoAdvanceEnabled(for: current)
                ? "本机手动设置 · 到期自动顺延一个月"
                : "本机手动设置"
        }
        if VPSFormat.date(server.quota["traffic_reset_at"]?.string) != nil { return "供应商返回" }
        return "供应商未提供，可手动设置"
    }

    private func usageDetail(_ used: Double?, _ total: Double?) -> String {
        guard used != nil || total != nil else { return "暂无数据" }
        return "\(VPSFormat.bytes(used)) / \(VPSFormat.bytes(total))"
    }

    private func display(_ value: JSONValue?) -> String {
        guard let value else { return VPSFormat.empty }
        switch value {
        case let .string(value): return value
        case let .number(value): return value.formatted(.number.precision(.fractionLength(0...3)))
        case let .bool(value): return value ? "是" : "否"
        case let .object(value): return "对象（\(value.count) 项）"
        case let .array(value): return "数组（\(value.count) 项）"
        case .null: return VPSFormat.empty
        }
    }
}

private struct StatusBadge: View {
    let state: ServerState
    let raw: String?

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(state.color).frame(width: 6, height: 6)
            Text(raw?.isEmpty == false ? raw! : state.label)
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(state.color.opacity(0.12), in: Capsule())
    }
}

private struct MetricTile: View {
    let title: String
    let value: String
    let detail: String
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(.title3, design: .rounded, weight: .semibold))
                .monospacedDigit()
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.primary.opacity(0.07), lineWidth: 1)
        }
    }
}

private struct SectionCard<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.primary.opacity(0.07), lineWidth: 1)
        }
    }
}

private struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .font(.caption)
    }
}

private struct HistoryChartView: View {
    let instance: MonitoredInstance
    @ObservedObject var store: MonitorStore
    @State private var hours = 24
    @State private var points: [HistoryPoint] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        SectionCard(title: "使用率趋势", symbol: "chart.xyaxis.line") {
            Picker("时间范围", selection: $hours) {
                Text("24 小时").tag(24)
                Text("7 天").tag(168)
                Text("30 天").tag(720)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Group {
                if isLoading, points.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 150)
                } else if let errorMessage, points.isEmpty {
                    ContentUnavailableView("无法加载历史", systemImage: "chart.xyaxis.line", description: Text(errorMessage))
                        .frame(height: 150)
                } else if samples.isEmpty {
                    ContentUnavailableView("暂无历史数据", systemImage: "chart.xyaxis.line")
                        .frame(height: 150)
                } else {
                    Chart(samples) { sample in
                        LineMark(
                            x: .value("时间", sample.date),
                            y: .value("使用率", sample.value),
                            series: .value("分段", sample.segment)
                        )
                        .foregroundStyle(by: .value("指标", sample.metric))
                        .lineStyle(StrokeStyle(lineWidth: 1.7))
                    }
                    .chartForegroundStyleScale(["CPU": Color.blue, "内存": Color.purple])
                    .chartYScale(domain: 0...100)
                    .chartYAxis {
                        AxisMarks(position: .leading, values: [0, 50, 100]) {
                            AxisGridLine().foregroundStyle(.secondary.opacity(0.16))
                            AxisValueLabel(format: Decimal.FormatStyle.Percent.percent.scale(1))
                        }
                    }
                    .chartXAxis {
                        AxisMarks(values: .automatic(desiredCount: 4)) {
                            AxisGridLine().foregroundStyle(.secondary.opacity(0.12))
                            AxisValueLabel(format: .dateTime.hour().minute())
                        }
                    }
                    .frame(height: 170)
                }
            }
        }
        .task(id: hours) { await load() }
    }

    private var samples: [HistorySample] {
        let stride = max(1, points.count / 320)
        let selected = points.enumerated().filter { $0.offset % stride == 0 }.map(\.element)
        return samples(for: "CPU", points: selected, value: { $0.metric("cpu_percent") }) +
            samples(for: "内存", points: selected, value: { $0.memoryPercent })
    }

    private func samples(
        for metric: String,
        points: [HistoryPoint],
        value: (HistoryPoint) -> Double?
    ) -> [HistorySample] {
        var segment = 0
        var result: [HistorySample] = []
        for point in points {
            guard let date = VPSFormat.date(point.observedAt), let metricValue = value(point) else {
                segment += 1
                continue
            }
            result.append(HistorySample(date: date, value: metricValue, metric: metric, segment: "\(metric)-\(segment)"))
        }
        return result
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            points = try await store.fetchHistory(for: instance, hours: hours).points
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct HistorySample: Identifiable {
    let id = UUID()
    let date: Date
    let value: Double
    let metric: String
    let segment: String
}
