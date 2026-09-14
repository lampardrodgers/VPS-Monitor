import Charts
import SwiftUI

struct HistoryChartView: View {
    let instance: MonitoredInstance
    @ObservedObject var store: MonitorStore

    var body: some View {
        VStack(spacing: 14) {
            HistoryChartSection(instance: instance, store: store, isTraffic: false)
            HistoryChartSection(instance: instance, store: store, isTraffic: true)
        }
    }
}

private struct HistoryChartSection: View {
    let instance: MonitoredInstance
    @ObservedObject var store: MonitorStore
    let isTraffic: Bool
    @State private var range: HistoryRange = .day
    @State private var points: [HistoryPoint] = []
    @State private var analysis = TrafficHistoryAnalysis(points: [], range: .day)
    @State private var samples: [HistorySample] = []
    @State private var windowEnd = Date.now
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedDate: Date?

    private var domain: ClosedRange<Date> {
        windowEnd.addingTimeInterval(-Double(range.rawValue) * 3_600)...windowEnd
    }
    private var taskID: String { "\(instance.id)-\(range.rawValue)" }

    var body: some View {
        Group {
            if !isTraffic {
                SectionCard(title: "使用率趋势", symbol: "chart.xyaxis.line") {
                    Picker("使用率时间范围", selection: $range) {
                        ForEach(HistoryRange.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    Text("\(domain.lowerBound.formatted(.dateTime.month().day().hour().minute())) — \(windowEnd.formatted(.dateTime.month().day().hour().minute()))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 170)
                    } else if let errorMessage {
                        loadError(errorMessage)
                    } else if samples.isEmpty {
                        empty("暂无使用率历史", detail: "此范围内没有 CPU 或内存采样。")
                    } else {
                        utilizationChart
                    }
                }
            } else {
                SectionCard(title: "流量消耗分析", symbol: "chart.bar.xaxis") {
                    Picker("流量消耗时间范围", selection: $range) {
                        ForEach(HistoryRange.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    HStack {
                        Text(range == .day ? "每小时新增消耗（估算）" : "每日新增消耗（估算）")
                        Spacer()
                        Text(range.title)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 170)
                    } else if let errorMessage {
                        loadError(errorMessage)
                    } else if analysis.buckets.isEmpty {
                        empty("暂无可分析的流量历史", detail: "需要同一流量周期内至少两次有效累计用量。未提供流量的供应商无法生成消耗图。")
                    } else {
                        trafficContent(analysis)
                    }
                }
            }
        }
        .task(id: taskID) { await load() }
    }

    private var utilizationChart: some View {
        Chart(samples) { sample in
            LineMark(
                x: .value("时间", sample.date),
                y: .value("使用率", sample.value),
                series: .value("分段", sample.segment)
            )
            .foregroundStyle(by: .value("指标", sample.metric))
            .lineStyle(StrokeStyle(lineWidth: 1.5))
        }
        .chartForegroundStyleScale(["CPU": Color.blue, "内存": Color.purple])
        .chartYScale(domain: 0...100)
        .chartXScale(domain: domain)
        .chartYAxis {
            AxisMarks(position: .leading, values: [0, 50, 100]) {
                AxisGridLine().foregroundStyle(.secondary.opacity(0.12))
                AxisValueLabel(format: Decimal.FormatStyle.Percent.percent.scale(1))
            }
        }
        .chartXAxis { timeAxis }
        .frame(height: 180)
    }

    @AxisContentBuilder private var timeAxis: some AxisContent {
        AxisMarks(values: .stride(by: range == .day ? .hour : .day, count: range == .day ? 6 : range == .week ? 2 : 7)) { value in
            AxisGridLine().foregroundStyle(.secondary.opacity(0.1))
            AxisValueLabel {
                if let date = value.as(Date.self) {
                    Text(range.axisLabel(date))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func trafficContent(_ data: TrafficHistoryAnalysis) -> some View {
        let selected = selectedDate.flatMap { date in
            data.buckets.first { date >= $0.start && date < $0.end }
        }
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                metric("已记录消耗", value: VPSFormat.bytes(data.totalBytes))
                metric("有效时段日均", value: VPSFormat.bytes(data.dailyAverage))
            }
            Chart(data.buckets) { bucket in
                if bucket.bytes == 0 {
                    PointMark(x: .value("时间", bucket.midpoint), y: .value("新增流量", 0))
                        .symbolSize(10)
                        .foregroundStyle(Color.blue.opacity(0.6))
                        .accessibilityLabel(bucket.start.formatted(date: .abbreviated, time: range == .day ? .shortened : .omitted))
                        .accessibilityValue("记录消耗 0 B")
                }
                BarMark(
                    xStart: .value("开始", max(bucket.start, domain.lowerBound)),
                    xEnd: .value("结束", min(bucket.end, domain.upperBound)),
                    y: .value("新增流量", bucket.bytes)
                )
                .foregroundStyle(Color.blue.opacity(selected == nil || selected?.id == bucket.id ? 0.8 : 0.3))
                .accessibilityLabel(bucket.start.formatted(date: .abbreviated, time: range == .day ? .shortened : .omitted))
                .accessibilityValue("记录消耗 \(VPSFormat.bytes(bucket.bytes))")
            }
            .chartXScale(domain: domain)
            .chartYScale(domain: 0...max(1, (data.peak?.bytes ?? 0) * 1.1))
            .chartXAxis { timeAxis }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                    AxisGridLine().foregroundStyle(.secondary.opacity(0.12))
                    AxisValueLabel {
                        if let bytes = value.as(Double.self) {
                            Text(VPSFormat.bytes(bytes)).font(.caption2)
                        }
                    }
                }
            }
            .chartXSelection(value: $selectedDate)
            .frame(height: 180)
            if let bucket = selected ?? data.peak {
                HStack(alignment: .firstTextBaseline) {
                    Text(selected == nil ? "最高记录时段" : "选中时段")
                    Spacer()
                    Text("\(bucket.start.formatted(date: .abbreviated, time: range == .day ? .shortened : .omitted)) · \(VPSFormat.bytes(bucket.bytes))")
                        .multilineTextAlignment(.trailing)
                }
                .font(.caption)
            }
            Text("有效采样覆盖 \((data.coveredSeconds / 3_600).formatted(.number.precision(.fractionLength(1)))) / \(range.rawValue) 小时；首尾时段可能不完整。")
                .font(.caption2)
                .foregroundStyle(.secondary)
            DisclosureGroup("计算方式与数据范围") {
                Text("根据供应商周期累计流量的增量计算，跨小时或日期按采样时长分摊，柱状值为估算。空缺不视为零；缺失记录、超过 1 小时的间隔、计数回退及周期重置不计入。日均按有效覆盖时长折算，至少需要 1 小时采样；不等同于完整周期账单。已排除 \(data.excludedIntervals) 个重置或间断区间。历史仅展示服务器实际保留的数据。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .font(.caption)
        }
    }

    private func metric(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func empty(_ title: String, detail: String) -> some View {
        ContentUnavailableView(title, systemImage: "chart.xyaxis.line", description: Text(detail))
            .frame(minHeight: 150)
    }

    private func loadError(_ message: String) -> some View {
        VStack(spacing: 8) {
            empty("无法加载历史", detail: message)
            Button("重试") { Task { await load() } }
        }
    }

    private func samples(for metric: String, value: (HistoryPoint) -> Double?) -> [HistorySample] {
        var segment = 0
        var previous: Date?
        var result: [HistorySample] = []
        for point in points {
            guard let date = VPSFormat.date(point.observedAt),
                  let metricValue = value(point), metricValue.isFinite else {
                segment += 1
                previous = nil
                continue
            }
            if let previous, date.timeIntervalSince(previous) > 3_600 { segment += 1 }
            previous = date
            result.append(HistorySample(date: date, value: metricValue, metric: metric, segment: "\(metric)-\(segment)"))
        }
        let chunkSize = max(1, result.count / 250)
        guard chunkSize > 1 else { return result }
        var reduced: [HistorySample] = []
        for segment in Dictionary(grouping: result, by: \.segment).values {
            for start in stride(from: 0, to: segment.count, by: chunkSize) {
                let chunk = Array(segment[start..<min(start + chunkSize, segment.count)])
                let selected = [chunk.first!, chunk.min { $0.value < $1.value }!,
                                chunk.max { $0.value < $1.value }!, chunk.last!]
                var seen = Set<String>()
                reduced.append(contentsOf: selected.sorted { $0.date < $1.date }.filter { seen.insert($0.id).inserted })
            }
        }
        return reduced.sorted { $0.date < $1.date }
    }

    private func load() async {
        let requestedID = taskID
        let requestedRange = range
        let end = Date.now
        windowEnd = end
        points = []
        selectedDate = nil
        errorMessage = nil
        isLoading = true
        do {
            let response = try await store.fetchHistory(for: instance, hours: requestedRange.rawValue)
            try Task.checkCancellation()
            guard requestedID == taskID else { return }
            points = response.points.filter {
                guard let date = VPSFormat.date($0.observedAt) else { return false }
                return date >= end.addingTimeInterval(-Double(requestedRange.rawValue) * 3_600) && date <= end
            }.sorted { (VPSFormat.date($0.observedAt) ?? .distantPast) < (VPSFormat.date($1.observedAt) ?? .distantPast) }
            if isTraffic {
                analysis = TrafficHistoryAnalysis(points: points, range: requestedRange)
            } else {
                samples = samples(for: "CPU", value: { $0.metric("cpu_percent") }) +
                    samples(for: "内存", value: { $0.memoryPercent })
            }
            isLoading = false
        } catch {
            guard !Task.isCancelled, requestedID == taskID else { return }
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
}

private struct HistorySample: Identifiable {
    var id: String { "\(metric)-\(date.timeIntervalSince1970)" }
    let date: Date
    let value: Double
    let metric: String
    let segment: String
}
