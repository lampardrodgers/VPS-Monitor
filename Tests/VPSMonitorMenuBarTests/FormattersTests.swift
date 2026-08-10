import XCTest
@testable import VPSMonitorMenuBar

final class FormattersTests: XCTestCase {
    func testFormatsByteAndBitUnitsSeparately() {
        XCTAssertEqual(VPSFormat.bytes(1_073_741_824), "1.00 GB")
        XCTAssertEqual(VPSFormat.bitrate(1_000_000), "1.00 Mbps")
        XCTAssertEqual(VPSFormat.bytes(nil), "—")
    }

    func testCalculatesMemoryFromAvailableValue() throws {
        let observation = InstanceObservation(
            provider: "test",
            instanceKey: "one",
            displayName: "One",
            observedAt: "2026-08-10T03:30:17+00:00",
            status: "running",
            metrics: [
                "memory_total_bytes": .number(1_000),
                "memory_available_bytes": .number(250)
            ],
            quota: [:],
            metadata: [:]
        )

        XCTAssertEqual(observation.memoryUsed, 750)
        XCTAssertEqual(observation.memoryPercent, 75)
    }

    func testLiveRefreshPresetAndCustomIntervals() {
        XCTAssertEqual(LiveRefreshSchedule.defaultValue.seconds, 300)
        XCTAssertEqual(LiveRefreshSchedule.defaultValue.compactTitle, "5 分钟")
        XCTAssertEqual(LiveRefreshSchedule.presets.map(\.seconds), [
            5, 30, 60, 300, 600, 1_800, 3_600, 21_600, 43_200, 86_400
        ])

        let custom = LiveRefreshSchedule(customValue: 2, unit: .hours)
        XCTAssertEqual(custom.seconds, 7_200)
        XCTAssertEqual(custom.title, "每 2 小时")
    }
}
