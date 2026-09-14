import Foundation

enum HistoryRange: Int, CaseIterable, Identifiable {
    case day = 24, week = 168, month = 720
    var id: Int { rawValue }
    var title: String {
        switch self {
        case .day: "24 小时"
        case .week: "7 天"
        case .month: "30 天"
        }
    }
    var bucketComponent: Calendar.Component { self == .day ? .hour : .day }

    func axisLabel(_ date: Date, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = timeZone
        formatter.dateFormat = self == .day ? "HH:mm" : "M/d"
        return formatter.string(from: date)
    }
}

struct TrafficHistoryBucket: Identifiable {
    var id: Date { start }
    let start: Date
    let end: Date
    var bytes: Double = 0
    var coveredSeconds: Double = 0
    var midpoint: Date { start.addingTimeInterval(end.timeIntervalSince(start) / 2) }
}

struct TrafficHistoryAnalysis {
    let buckets: [TrafficHistoryBucket]
    let excludedIntervals: Int
    var totalBytes: Double { buckets.reduce(0) { $0 + $1.bytes } }
    var coveredSeconds: Double { buckets.reduce(0) { $0 + $1.coveredSeconds } }
    var dailyAverage: Double? {
        // Very short samples are not a useful daily consumption estimate.
        coveredSeconds >= 3_600 ? totalBytes / coveredSeconds * 86_400 : nil
    }
    var peak: TrafficHistoryBucket? { buckets.max { $0.bytes < $1.bytes } }

    init(points: [HistoryPoint], range: HistoryRange, calendar: Calendar = .current) {
        let ordered = points.compactMap { point -> (Date, HistoryPoint)? in
            VPSFormat.date(point.observedAt).map { ($0, point) }
        }.sorted { $0.0 < $1.0 }
        var grouped: [Date: TrafficHistoryBucket] = [:]
        var previous: (date: Date, bytes: Double, reset: Date?)?
        var excluded = 0

        for (date, point) in ordered {
            guard let used = point.quota["traffic_used_bytes"]?.number, used.isFinite, used >= 0 else {
                previous = nil
                continue
            }
            let reset = VPSFormat.date(point.quota["traffic_reset_at"]?.string)
            defer { previous = (date, used, reset) }
            guard let prior = previous else { continue }
            let duration = date.timeIntervalSince(prior.date)
            guard duration > 0 else { continue }
            let crossedReset = prior.reset.map { $0 > prior.date && $0 <= date } ?? false
            let changedCycle = prior.reset != nil && reset != nil && prior.reset != reset
            // Counter decreases/cycle changes cannot reveal consumption across a reset.
            // Long gaps are not spread across days as if continuously observed.
            guard used >= prior.bytes, !crossedReset, !changedCycle, duration <= 3_600 else {
                excluded += 1
                continue
            }
            let delta = used - prior.bytes
            var cursor = prior.date
            while cursor < date {
                guard let interval = calendar.dateInterval(of: range.bucketComponent, for: cursor) else { break }
                let end = min(date, interval.end)
                let seconds = end.timeIntervalSince(cursor)
                guard seconds > 0 else { break }
                var bucket = grouped[interval.start] ?? TrafficHistoryBucket(start: interval.start, end: interval.end)
                bucket.bytes += delta * seconds / duration
                bucket.coveredSeconds += seconds
                grouped[interval.start] = bucket
                cursor = end
            }
        }
        buckets = grouped.values.sorted { $0.start < $1.start }
        excludedIntervals = excluded
    }
}
