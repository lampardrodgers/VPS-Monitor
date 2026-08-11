import Foundation
import SwiftUI

enum VPSFormat {
    static let empty = "—"

    static func bytes(_ bytes: Double?) -> String {
        guard let bytes, bytes.isFinite else { return empty }
        if bytes == 0 { return "0 B" }
        let units = ["B", "KB", "MB", "GB", "TB", "PB"]
        var value = abs(bytes)
        var index = 0
        while value >= 1024, index < units.count - 1 {
            value /= 1024
            index += 1
        }
        let digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
        return "\(bytes < 0 ? "-" : "")\(value.formatted(.number.precision(.fractionLength(digits)))) \(units[index])"
    }

    static func bitrate(_ bits: Double?) -> String {
        guard let bits, bits.isFinite else { return empty }
        if bits == 0 { return "0 bps" }
        let units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"]
        var value = abs(bits)
        var index = 0
        while value >= 1000, index < units.count - 1 {
            value /= 1000
            index += 1
        }
        let digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
        return "\(bits < 0 ? "-" : "")\(value.formatted(.number.precision(.fractionLength(digits)))) \(units[index])"
    }

    static func percent(_ value: Double?) -> String {
        guard let value, value.isFinite else { return empty }
        return "\(value.formatted(.number.precision(.fractionLength(1))))%"
    }

    static func date(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        if let value = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(raw) {
            return value
        }
        if let value = try? Date.ISO8601FormatStyle().parse(raw) {
            return value
        }
        if !raw.hasSuffix("Z"), !raw.contains("+") {
            return try? Date.ISO8601FormatStyle().parse(raw + "Z")
        }
        return nil
    }

    static func relative(_ raw: String?, now: Date = .now) -> String {
        guard let date = date(raw) else { return empty }
        let seconds = now.timeIntervalSince(date)
        let absolute = abs(seconds)
        if absolute < 10 { return "刚刚" }
        let value: String
        if absolute < 60 {
            value = "\(max(1, Int(absolute.rounded()))) 秒"
        } else if absolute < 3_600 {
            value = "\(Int((absolute / 60).rounded())) 分钟"
        } else if absolute < 86_400 {
            value = "\(Int(absolute / 3_600)) 小时"
        } else {
            value = "\(Int(absolute / 86_400)) 天"
        }
        return seconds >= 0 ? "\(value)前" : "\(value)后"
    }
}

enum ServerState: String, Sendable {
    case online
    case offline
    case transitional
    case unknown

    var label: String {
        switch self {
        case .online: "在线"
        case .offline: "离线"
        case .transitional: "变更中"
        case .unknown: "未知"
        }
    }

    var color: Color {
        switch self {
        case .online: .green
        case .offline: .red
        case .transitional: .orange
        case .unknown: .secondary
        }
    }
}

extension InstanceObservation {
    var normalizedState: ServerState {
        let key = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let online: Set<String> = ["running", "ready", "online", "active", "up", "started", "1", "poweron"]
        let offline: Set<String> = ["0", "stopped", "offline", "shutdown", "poweroff", "halted", "down", "suspended", "terminated", "expired", "deleted", "error", "failed"]
        let transitional: Set<String> = ["starting", "stopping", "pending", "rebooting", "restarting", "building", "installing", "resetting", "upgrading", "migrating"]
        if online.contains(key) { return .online }
        if offline.contains(key) { return .offline }
        if transitional.contains(key) { return .transitional }
        return .unknown
    }

    var isStale: Bool {
        guard let date = VPSFormat.date(observedAt) else { return true }
        return Date.now.timeIntervalSince(date) > 600
    }

    func metric(_ key: String) -> Double? { metrics[key]?.number }
    func quotaNumber(_ key: String) -> Double? { quota[key]?.number }

    func metadataText(_ keys: String...) -> String? {
        for key in keys {
            if let value = metadata[key]?.string, !value.isEmpty { return value }
        }
        return nil
    }

    var memoryUsed: Double? {
        if let value = metric("memory_used_bytes") { return value }
        if let available = metric("memory_available_bytes"), let total = metric("memory_total_bytes") {
            return max(0, total - available)
        }
        return nil
    }

    var memoryPercent: Double? { Self.ratio(memoryUsed, metric("memory_total_bytes")) }
    var diskPercent: Double? { Self.ratio(metric("disk_used_bytes"), metric("disk_total_bytes")) }

    var trafficPercent: Double? {
        Self.ratio(quotaNumber("traffic_used_bytes"), quotaNumber("traffic_total_bytes"))
    }

    var providerDisplayName: String {
        switch provider.lowercased() {
        case "aliyun_swas": "阿里云 SWAS"
        case "bandwagon": "BandwagonHost"
        case "panstar": "Panstar"
        case "virtfusion", "greencloud": "GreenCloud"
        case "virtualizor", "dedione": "DediOne"
        case "racknerd": "RackNerd"
        default: provider.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private static func ratio(_ used: Double?, _ total: Double?) -> Double? {
        guard let used, let total, total > 0 else { return nil }
        return min(100, max(0, used / total * 100))
    }
}

extension HistoryPoint {
    func metric(_ key: String) -> Double? { metrics[key]?.number }

    var memoryPercent: Double? {
        let total = metric("memory_total_bytes")
        var used = metric("memory_used_bytes")
        if used == nil, let total, let available = metric("memory_available_bytes") {
            used = max(0, total - available)
        }
        guard let used, let total, total > 0 else { return nil }
        return min(100, max(0, used / total * 100))
    }
}
