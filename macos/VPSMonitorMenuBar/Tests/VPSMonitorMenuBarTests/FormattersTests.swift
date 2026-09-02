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

    func testExtractsAndMasksMixedProviderIPShapes() {
        let observation = InstanceObservation(
            provider: "test",
            instanceKey: "ip-test",
            displayName: "IP Test",
            observedAt: "2026-08-11T00:00:00Z",
            status: "running",
            metrics: [:],
            quota: [:],
            metadata: [
                "ip": .array([
                    .object([
                        "address": .string("192.0.2.244"),
                        "gateway": .string("192.0.2.1"),
                        "netmask": .string("255.255.255.0")
                    ]),
                    .object([
                        "s20752": .string("2602:F873:0011:0603:0000:0001:ec3d:7c16")
                    ])
                ]),
                "private_ip": .string("198.51.100.51"),
                "unrelated": .string("203.0.113.8")
            ]
        )

        XCTAssertEqual(observation.ipAddresses.ipv4, ["192.0.2.244", "198.51.100.51"])
        XCTAssertEqual(observation.ipAddresses.ipv6, ["2602:f873:11:603:0:1:ec3d:7c16"])
        XCTAssertEqual(IPAddressPrivacy.masked("192.168.10.20"), "192.168.*.*")
        XCTAssertEqual(
            IPAddressPrivacy.masked("2602:f873:11:603::1"),
            "2602:f873:****:****:****:****:****:****"
        )
    }

    func testMissingIPv6ProducesEmptyIPv6List() {
        let observation = InstanceObservation(
            provider: "test",
            instanceKey: "ipv4-only",
            displayName: "IPv4 only",
            observedAt: "2026-08-11T00:00:00Z",
            status: "running",
            metrics: [:],
            quota: [:],
            metadata: ["ip_addresses": .array([.string("203.0.113.34")])]
        )

        XCTAssertEqual(observation.ipAddresses.ipv4, ["203.0.113.34"])
        XCTAssertTrue(observation.ipAddresses.ipv6.isEmpty)
    }

    @MainActor
    func testWindowSizeIsClampedToUsableMinimum() {
        XCTAssertEqual(
            MenuBarPanelSize.constrained(NSSize(width: 250, height: 300)),
            NSSize(width: 400, height: 480)
        )
        XCTAssertEqual(
            MenuBarPanelSize.constrained(NSSize(width: 720, height: 860)),
            NSSize(width: 720, height: 860)
        )

        let suiteName = "VPSMonitorMenuBarTests.window.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set("{720, 860}", forKey: MenuBarPanelSize.defaultsKey)
        XCTAssertEqual(
            MenuBarPanelSize.restoredSize(defaults: defaults),
            NSSize(width: 720, height: 860)
        )
    }
}
