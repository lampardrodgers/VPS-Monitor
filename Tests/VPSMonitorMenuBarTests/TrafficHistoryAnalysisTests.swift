import XCTest
@testable import VPSMonitorMenuBar

final class TrafficHistoryAnalysisTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func point(_ date: String, _ bytes: Double?, reset: String? = nil) -> HistoryPoint {
        var quota: [String: JSONValue] = [:]
        if let bytes { quota["traffic_used_bytes"] = .number(bytes) }
        if let reset { quota["traffic_reset_at"] = .string(reset) }
        return HistoryPoint(observedAt: date, status: nil, metrics: [:], quota: quota)
    }

    func testTimeAxisUses24HourTimeOnlyForDayRange() {
        let date = VPSFormat.date("2026-09-14T13:30:00Z")!
        let zone = calendar.timeZone
        XCTAssertEqual(HistoryRange.day.axisLabel(date, timeZone: zone), "13:30")
        XCTAssertEqual(HistoryRange.week.axisLabel(date, timeZone: zone), "9/14")
        XCTAssertEqual(HistoryRange.month.axisLabel(date, timeZone: zone), "9/14")
    }

    func testSplitsConsumptionAtMidnightAndUsesCoveredTimeForAverage() {
        let data = TrafficHistoryAnalysis(points: [
            point("2026-09-13T23:30:00Z", 100),
            point("2026-09-14T00:30:00Z", 300)
        ], range: .week, calendar: calendar)
        XCTAssertEqual(data.buckets.map(\.bytes), [100, 100])
        XCTAssertEqual(data.totalBytes, 200)
        XCTAssertEqual(data.coveredSeconds, 3_600)
        XCTAssertEqual(data.dailyAverage, 4_800)
    }

    func testResetAndLongGapsAreNotCountedAsConsumption() {
        let data = TrafficHistoryAnalysis(points: [
            point("2026-09-14T00:00:00Z", 900),
            point("2026-09-14T00:30:00Z", 100),
            point("2026-09-14T01:00:00Z", 150),
            point("2026-09-14T04:00:00Z", 800)
        ], range: .day, calendar: calendar)
        XCTAssertEqual(data.totalBytes, 50)
        XCTAssertEqual(data.coveredSeconds, 1_800)
        XCTAssertEqual(data.excludedIntervals, 2)
        XCTAssertNil(data.dailyAverage)
    }

    func testResetBoundaryWithIncreasingCounterIsExcluded() {
        let data = TrafficHistoryAnalysis(points: [
            point("2026-09-13T23:30:00Z", 100, reset: "2026-09-14T00:00:00Z"),
            point("2026-09-14T00:00:00Z", 200, reset: "2026-10-14T00:00:00Z")
        ], range: .week, calendar: calendar)
        XCTAssertTrue(data.buckets.isEmpty)
        XCTAssertEqual(data.excludedIntervals, 1)
    }

    func testMissingValuesBreakCoverageAndZeroIsAnObservation() {
        let data = TrafficHistoryAnalysis(points: [
            point("2026-09-14T00:00:00Z", 10),
            point("2026-09-14T00:10:00Z", nil),
            point("2026-09-14T00:20:00Z", 100),
            point("2026-09-14T00:30:00Z", 100)
        ], range: .day, calendar: calendar)
        XCTAssertEqual(data.buckets.count, 1)
        XCTAssertEqual(data.totalBytes, 0)
        XCTAssertEqual(data.coveredSeconds, 600)
    }

    func testUnorderedSamplesAreSortedWithoutCountingInitialCounter() {
        let data = TrafficHistoryAnalysis(points: [
            point("2026-09-14T01:00:00Z", 500),
            point("2026-09-14T00:00:00Z", 450)
        ], range: .day, calendar: calendar)
        XCTAssertEqual(data.totalBytes, 50)
        XCTAssertEqual(data.buckets.count, 1)
    }
}
