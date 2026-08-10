import SwiftUI

struct ServerRowView: View {
    let instance: MonitoredInstance
    let displayName: String
    let countryCode: String?
    let effectiveResetTime: Date?

    private var server: InstanceObservation { instance.observation }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                Text(countryCode.map(CountryCatalog.flag(for:)) ?? "")
                    .font(.title2)
                    .frame(width: 31)
                Circle()
                    .fill(server.normalizedState.color)
                    .frame(width: 8, height: 8)
                    .overlay {
                        if server.normalizedState == .online {
                            Circle().stroke(server.normalizedState.color.opacity(0.24), lineWidth: 4)
                        }
                    }
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName)
                        .font(.system(.body, weight: .semibold))
                        .lineLimit(1)
                    HStack(spacing: 5) {
                        Text(server.providerDisplayName)
                        if instance.source != .local { Text("· \(instance.source.name)") }
                        if let region = server.metadataText("region", "location", "datacenter", "node") {
                            Text("· \(region)")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }
                Spacer()
                if server.isStale {
                    Text("陈旧")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.orange.opacity(0.12), in: Capsule())
                }
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }

            HStack(spacing: 12) {
                CompactMetric(label: "CPU", value: VPSFormat.percent(server.metric("cpu_percent")))
                CompactMetric(label: "内存", value: VPSFormat.percent(server.memoryPercent))
                CompactMetric(label: "磁盘", value: VPSFormat.percent(server.diskPercent))
                Spacer(minLength: 0)
                HStack(spacing: 3) {
                    Image(systemName: "arrow.down")
                    Text(VPSFormat.bitrate(server.metric("network_in_bps")))
                    Image(systemName: "arrow.up")
                    Text(VPSFormat.bitrate(server.metric("network_out_bps")))
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }

            if hasTrafficData {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(trafficDescription)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.78)
                        Spacer(minLength: 4)
                        Text(resetDescription)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                    if let progress = trafficProgress {
                        TrafficProgressBar(progress: progress, color: trafficColor)
                            .accessibilityHidden(true)
                    }
                }
            }
        }
        .padding(11)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
        }
        .contentShape(Rectangle())
    }

    private var trafficProgress: Double? {
        if let percent = server.trafficPercent { return percent / 100 }
        if server.quotaNumber("traffic_used_bytes") != nil,
           server.quotaNumber("traffic_total_bytes") == nil {
            return 1
        }
        return nil
    }

    private var trafficColor: Color {
        if server.quotaNumber("traffic_used_bytes") != nil,
           server.quotaNumber("traffic_total_bytes") == nil {
            return .blue
        }
        guard let percent = server.trafficPercent else { return .accentColor }
        if percent >= 95 { return .red }
        if percent >= 80 { return .orange }
        return .accentColor
    }

    private var hasTrafficData: Bool {
        server.quota["traffic_unlimited"]?.bool == true ||
            server.quotaNumber("traffic_used_bytes") != nil ||
            server.quotaNumber("traffic_total_bytes") != nil ||
            effectiveResetTime != nil
    }

    private var trafficDescription: String {
        if server.quota["traffic_unlimited"]?.bool == true {
            return "流量  无限流量 / 带宽型"
        }
        let used = server.quotaNumber("traffic_used_bytes")
        let total = server.quotaNumber("traffic_total_bytes")
        if let used, let total, total > 0 {
            return "已用 \(VPSFormat.bytes(used)) / 总额 \(VPSFormat.bytes(total)) · \(VPSFormat.percent(server.trafficPercent))"
        }
        if let used {
            return "已用 \(VPSFormat.bytes(used)) / 总额未提供"
        }
        return "流量数据未提供"
    }

    private var resetDescription: String {
        guard let effectiveResetTime else {
            return "重置 —"
        }
        return "重置 \(effectiveResetTime.formatted(.dateTime.month(.twoDigits).day(.twoDigits).hour().minute()))"
    }
}

struct TrafficProgressBar: View {
    let progress: Double
    let color: Color
    var accessibilityText: String? = nil

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.12))
                Capsule()
                    .fill(color)
                    .frame(width: max(4, proxy.size.width * min(1, max(0, progress))))
            }
        }
        .frame(height: 5)
        .accessibilityElement()
        .accessibilityLabel("流量使用进度")
        .accessibilityValue(accessibilityText ?? VPSFormat.percent(progress * 100))
    }
}

private struct CompactMetric: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 4) {
            Text(label)
                .foregroundStyle(.secondary)
            Text(value)
                .fontWeight(.medium)
                .monospacedDigit()
        }
        .font(.caption)
        .lineLimit(1)
    }
}
