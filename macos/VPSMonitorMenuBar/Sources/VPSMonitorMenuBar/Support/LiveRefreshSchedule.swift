import Foundation

enum LiveIntervalUnit: String, Codable, CaseIterable, Hashable, Identifiable, Sendable {
    case seconds
    case minutes
    case hours
    case days

    var id: String { rawValue }

    var multiplier: Int {
        switch self {
        case .seconds: 1
        case .minutes: 60
        case .hours: 3_600
        case .days: 86_400
        }
    }

    var title: String {
        switch self {
        case .seconds: "秒"
        case .minutes: "分钟"
        case .hours: "小时"
        case .days: "天"
        }
    }
}

struct LiveRefreshSchedule: Codable, Hashable, Sendable, Identifiable {
    let presetSeconds: Int?
    let customValue: Int?
    let customUnit: LiveIntervalUnit?

    var id: String {
        if let presetSeconds { return "preset-\(presetSeconds)" }
        return "custom-\(customValue ?? 1)-\(customUnit?.rawValue ?? "minutes")"
    }

    var seconds: Int {
        if let presetSeconds { return max(1, presetSeconds) }
        let value = max(1, min(customValue ?? 1, 9_999))
        let multiplier = (customUnit ?? .minutes).multiplier
        return value * multiplier
    }

    var title: String {
        if let presetSeconds { return Self.title(for: presetSeconds) }
        return "每 \(max(1, customValue ?? 1)) \((customUnit ?? .minutes).title)"
    }

    var compactTitle: String {
        if let presetSeconds { return Self.compactTitle(for: presetSeconds) }
        return "\(max(1, customValue ?? 1))\((customUnit ?? .minutes).title)"
    }

    var isAggressive: Bool { seconds < 30 }

    init(presetSeconds: Int) {
        self.presetSeconds = presetSeconds
        customValue = nil
        customUnit = nil
    }

    init(customValue: Int, unit: LiveIntervalUnit) {
        presetSeconds = nil
        self.customValue = max(1, min(customValue, 9_999))
        customUnit = unit
    }

    static let defaultValue = LiveRefreshSchedule(presetSeconds: 300)

    static let presets: [LiveRefreshSchedule] = [
        5, 30, 60, 300, 600, 1_800, 3_600, 21_600, 43_200, 86_400
    ].map(LiveRefreshSchedule.init(presetSeconds:))

    private static func title(for seconds: Int) -> String {
        switch seconds {
        case 5: "每 5 秒"
        case 30: "每 30 秒"
        case 60: "每 1 分钟"
        case 300: "每 5 分钟"
        case 600: "每 10 分钟"
        case 1_800: "每 30 分钟"
        case 3_600: "每 1 小时"
        case 21_600: "每 6 小时"
        case 43_200: "每 12 小时"
        case 86_400: "每 24 小时"
        default: "每 \(seconds) 秒"
        }
    }

    private static func compactTitle(for seconds: Int) -> String {
        switch seconds {
        case 5: "5 秒"
        case 30: "30 秒"
        case 60: "1 分钟"
        case 300: "5 分钟"
        case 600: "10 分钟"
        case 1_800: "30 分钟"
        case 3_600: "1 小时"
        case 21_600: "6 小时"
        case 43_200: "12 小时"
        case 86_400: "24 小时"
        default: "\(seconds) 秒"
        }
    }
}
