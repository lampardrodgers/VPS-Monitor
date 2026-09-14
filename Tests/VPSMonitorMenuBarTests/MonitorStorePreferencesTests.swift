import XCTest
import Darwin
@testable import VPSMonitorMenuBar

@MainActor
final class MonitorStorePreferencesTests: XCTestCase {
    func testMonthlyResetKeepsOriginalDayAnchorAcrossShortMonth() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 8 * 3_600))
        let january31 = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2030, month: 1, day: 31, hour: 10, minute: 25
        )))

        let february = try XCTUnwrap(MonitorStore.nextMonthlyResetDate(
            after: january31,
            anchorDay: 31,
            calendar: calendar
        ))
        XCTAssertEqual(calendar.component(.month, from: february), 2)
        XCTAssertEqual(calendar.component(.day, from: february), 28)
        XCTAssertEqual(calendar.component(.hour, from: february), 10)
        XCTAssertEqual(calendar.component(.minute, from: february), 25)

        let march = try XCTUnwrap(MonitorStore.nextMonthlyResetDate(
            after: february,
            anchorDay: 31,
            calendar: calendar
        ))
        XCTAssertEqual(calendar.component(.month, from: march), 3)
        XCTAssertEqual(calendar.component(.day, from: march), 31)
    }

    func testAliasAndAutomaticResetPreferencesPersist() throws {
        let suiteName = "VPSMonitorMenuBarTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let instance = MonitoredInstance(
            source: .local,
            observation: InstanceObservation(
                provider: "test",
                instanceKey: "one",
                displayName: "Original",
                observedAt: "2030-01-01T00:00:00Z",
                status: "running",
                metrics: [:],
                quota: [:],
                metadata: ["country_code": .string("US")]
            )
        )
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 8 * 3_600))
        let january31 = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2030, month: 1, day: 31, hour: 10, minute: 25
        )))
        let march1 = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2030, month: 3, day: 1, hour: 0, minute: 0
        )))

        let store = MonitorStore(defaults: defaults)
        store.setAlias("Hong Kong Relay", for: instance)
        XCTAssertEqual(store.effectiveCountryCode(for: instance), "US")
        store.setCountryOverride("JP", for: instance)
        store.setManualResetTime(january31, for: instance)
        store.setResetAutoAdvanceEnabled(true, for: instance)
        store.advanceExpiredResetTimes(now: march1, calendar: calendar)

        XCTAssertEqual(store.displayName(for: instance), "Hong Kong Relay")
        let advanced = try XCTUnwrap(store.manualResetTime(for: instance))
        XCTAssertEqual(calendar.component(.month, from: advanced), 3)
        XCTAssertEqual(calendar.component(.day, from: advanced), 31)

        let reloaded = MonitorStore(defaults: defaults)
        XCTAssertEqual(reloaded.displayName(for: instance), "Hong Kong Relay")
        XCTAssertEqual(reloaded.effectiveCountryCode(for: instance), "JP")
        XCTAssertTrue(reloaded.isResetAutoAdvanceEnabled(for: instance))

        reloaded.setCountryOverride(nil, for: instance)
        XCTAssertEqual(reloaded.effectiveCountryCode(for: instance), "US")
    }

    func testLegacyCountryOverrideMigratesToStableInstanceID() throws {
        let suiteName = "VPSMonitorMenuBarTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let instance = MonitoredInstance(
            source: .local,
            observation: InstanceObservation(
                provider: "aliyun_swas",
                instanceKey: "legacy-instance",
                displayName: "Aliyun",
                observedAt: "2030-01-01T00:00:00Z",
                status: "running",
                metrics: [:],
                quota: [:],
                metadata: [:]
            )
        )
        let legacyCountryKey = instance.legacyID
        let cachedData = try JSONEncoder.vpsMonitor.encode([instance])
        defaults.set(cachedData, forKey: "monitor.cachedInstances.v1")
        defaults.set(
            try JSONEncoder.vpsMonitor.encode([legacyCountryKey: "CN"]),
            forKey: "monitor.countryOverrides.v1"
        )

        let store = MonitorStore(defaults: defaults)

        XCTAssertEqual(store.effectiveCountryCode(for: instance), "CN")
        let saved = try XCTUnwrap(defaults.data(forKey: "monitor.countryOverrides.v1"))
        let savedOverrides = try JSONDecoder.vpsMonitor.decode([String: String].self, from: saved)
        XCTAssertEqual(savedOverrides[instance.id], "CN")
        XCTAssertNil(savedOverrides[legacyCountryKey])
    }

    func testCountryUsesOnlyExplicitAPIFields() {
        let regionOnly = InstanceObservation(
            provider: "test",
            instanceKey: "region-only",
            displayName: "Region only",
            observedAt: "2030-01-01T00:00:00Z",
            status: "running",
            metrics: [:],
            quota: [:],
            metadata: ["region_id": .string("cn-hangzhou")]
        )
        let explicit = InstanceObservation(
            provider: "test",
            instanceKey: "explicit-country",
            displayName: "Explicit country",
            observedAt: "2030-01-01T00:00:00Z",
            status: "running",
            metrics: [:],
            quota: [:],
            metadata: ["country": .string("China")]
        )

        XCTAssertNil(CountryCatalog.apiCountryCode(for: regionOnly))
        XCTAssertEqual(CountryCatalog.apiCountryCode(for: explicit), "CN")
    }

    func testSSHTunnelConfigurationOnlyMatchesItsLoopbackPort() {
        let configuration = SSHTunnelConfiguration(
            target: "root@example.test",
            localPort: 8_787,
            remoteHost: "127.0.0.1",
            remotePort: 18_787,
            identityFile: nil
        )
        let matching = MonitorSource(
            id: UUID(),
            name: "Local API",
            baseURL: "http://localhost:8787/",
            isEnabled: true
        )
        let otherLocalPort = MonitorSource(
            id: UUID(),
            name: "Other local service",
            baseURL: "http://127.0.0.1:9000",
            isEnabled: true
        )
        let remote = MonitorSource(
            id: UUID(),
            name: "Remote API",
            baseURL: "https://monitor.example.test",
            isEnabled: true
        )

        XCTAssertTrue(configuration.applies(to: matching))
        XCTAssertFalse(configuration.applies(to: otherLocalPort))
        XCTAssertFalse(configuration.applies(to: remote))
    }

    func testSSHTunnelConfigurationSavesOutsideApplicationBundle() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("VPSMonitorMenuBarTests.\(UUID().uuidString)", isDirectory: true)
        setenv("VPSMON_MACOS_CONFIG_DIR", directory.path, 1)
        defer {
            unsetenv("VPSMON_MACOS_CONFIG_DIR")
            try? FileManager.default.removeItem(at: directory)
        }

        try SSHTunnelConfiguration.save(
            target: "monitor@example.test",
            remotePort: 18_787,
            identityFile: "~/.ssh/id_ed25519"
        )

        let loaded = try XCTUnwrap(SSHTunnelConfiguration.load())
        XCTAssertEqual(loaded.target, "monitor@example.test")
        XCTAssertEqual(loaded.remotePort, 18_787)
        XCTAssertTrue(loaded.identityFile?.hasSuffix("/.ssh/id_ed25519") == true)
        let attributes = try FileManager.default.attributesOfItem(atPath: SSHTunnelConfiguration.storagePath)
        XCTAssertEqual(attributes[.posixPermissions] as? NSNumber, NSNumber(value: 0o600))
    }
}
