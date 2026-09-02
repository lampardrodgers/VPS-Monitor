import XCTest
@testable import VPSMonitorMenuBar

final class CloudSyncTests: XCTestCase {
    func testStableInstanceIDDoesNotDependOnSourceUUID() {
        let sourceA = MonitorSource(
            id: UUID(),
            name: "A",
            baseURL: "https://monitor.example.test/",
            isEnabled: true
        )
        let sourceB = MonitorSource(
            id: UUID(),
            name: "B",
            baseURL: "https://monitor.example.test",
            isEnabled: true
        )
        let observation = InstanceObservation(
            provider: "test",
            instanceKey: "one",
            displayName: "One",
            observedAt: "2030-01-01T00:00:00Z",
            status: "running",
            metrics: [:],
            quota: [:],
            metadata: [:]
        )

        XCTAssertEqual(
            MonitoredInstance(source: sourceA, observation: observation).id,
            MonitoredInstance(source: sourceB, observation: observation).id
        )
    }

    func testCloudMergeTakesUnionAndDeduplicatesSources() {
        let early = Date(timeIntervalSince1970: 100)
        let later = Date(timeIntervalSince1970: 200)
        let local = snapshot(sourceKeys: ["1", "2", "3"], updatedAt: early)
        let cloud = snapshot(sourceKeys: ["2", "4", "5"], updatedAt: later)

        let result = CloudSyncMerger.merge(local: local, cloud: cloud, completedAt: later)

        XCTAssertEqual(
            Set(result.snapshot.sources.filter { !$0.isDeleted }.map(\.key)),
            Set(["1", "2", "3", "4", "5"])
        )
        XCTAssertEqual(result.summary.duplicateSourceCount, 1)
        XCTAssertEqual(result.summary.mergedSourceCount, 5)
    }

    func testCloudMergeAcrossThreeDevicesTakesCompleteUnion() {
        let deviceA = snapshot(sourceKeys: ["1", "2", "3"], updatedAt: Date(timeIntervalSince1970: 100))
        let deviceB = snapshot(sourceKeys: ["2", "4", "5"], updatedAt: Date(timeIntervalSince1970: 200))
        let deviceC = snapshot(sourceKeys: ["1", "5"], updatedAt: Date(timeIntervalSince1970: 300))

        let firstMerge = CloudSyncMerger.merge(local: deviceA, cloud: deviceB)
        let finalMerge = CloudSyncMerger.merge(local: firstMerge.snapshot, cloud: deviceC)

        XCTAssertEqual(
            Set(finalMerge.snapshot.sources.filter { !$0.isDeleted }.map(\.key)),
            Set(["1", "2", "3", "4", "5"])
        )
    }

    func testLegacyPreferenceIDsMigrateAndKeepFlagsFromOlderRecords() throws {
        let legacyID = "A11CE000-0000-4000-8000-000000000001|aliyun_swas|one"
        let stableID = "local-tunnel|aliyun_swas|one"
        let oldDate = Date(timeIntervalSince1970: 100)
        let newerDate = Date(timeIntervalSince1970: 200)
        let snapshot = CloudSyncSnapshot(
            sources: [],
            preferences: [
                CloudSyncPreferenceEntry(
                    id: legacyID,
                    alias: "阿里云杭州",
                    countryOverride: "CN",
                    manualResetTime: nil,
                    resetDayAnchor: nil,
                    autoAdvance: false,
                    updatedAt: oldDate
                ),
                CloudSyncPreferenceEntry(
                    id: stableID,
                    alias: nil,
                    countryOverride: nil,
                    manualResetTime: nil,
                    resetDayAnchor: nil,
                    autoAdvance: false,
                    updatedAt: newerDate
                )
            ],
            order: [legacyID, stableID],
            orderUpdatedAt: newerDate
        )

        let migrated = CloudSyncMerger.migratedSnapshot(
            snapshot,
            using: [legacyID: stableID]
        )

        XCTAssertEqual(migrated.order, [stableID])
        XCTAssertEqual(migrated.preferences.count, 1)
        XCTAssertEqual(migrated.preferences.first?.id, stableID)
        XCTAssertEqual(migrated.preferences.first?.alias, "阿里云杭州")
        XCTAssertEqual(migrated.preferences.first?.countryOverride, "CN")
    }

    func testMissingCountryValueDoesNotEraseExistingFlagButExplicitClearDoes() {
        let id = "local-tunnel|aliyun_swas|one"
        let local = preferenceSnapshot(
            CloudSyncPreferenceEntry(
                id: id,
                alias: "阿里云杭州",
                countryOverride: "CN",
                manualResetTime: nil,
                resetDayAnchor: nil,
                autoAdvance: false,
                updatedAt: Date(timeIntervalSince1970: 100)
            )
        )
        let legacyCloud = preferenceSnapshot(
            CloudSyncPreferenceEntry(
                id: id,
                alias: nil,
                countryOverride: nil,
                manualResetTime: nil,
                resetDayAnchor: nil,
                autoAdvance: false,
                updatedAt: Date(timeIntervalSince1970: 200)
            )
        )

        let preserved = CloudSyncMerger.merge(local: local, cloud: legacyCloud)
        XCTAssertEqual(preserved.snapshot.preferences.first?.countryOverride, "CN")

        let clearedCloud = preferenceSnapshot(
            CloudSyncPreferenceEntry(
                id: id,
                alias: nil,
                countryOverride: nil,
                manualResetTime: nil,
                resetDayAnchor: nil,
                autoAdvance: false,
                updatedAt: Date(timeIntervalSince1970: 200),
                countryOverrideCleared: true
            )
        )
        let cleared = CloudSyncMerger.merge(local: local, cloud: clearedCloud)
        XCTAssertNil(cleared.snapshot.preferences.first?.countryOverride)
        XCTAssertTrue(cleared.snapshot.preferences.first?.countryOverrideCleared == true)
    }

    func testNewerDeletionWinsButNewerReAddCanRestoreSource() {
        let sourceID = UUID()
        let active = CloudSyncSourceEntry(
            key: "same",
            id: sourceID,
            name: "Same",
            baseURL: "https://same.example.test",
            isEnabled: true,
            updatedAt: Date(timeIntervalSince1970: 100),
            deletedAt: nil
        )
        let deleted = CloudSyncSourceEntry(
            key: "same",
            id: sourceID,
            name: "Same",
            baseURL: "https://same.example.test",
            isEnabled: true,
            updatedAt: Date(timeIntervalSince1970: 200),
            deletedAt: Date(timeIntervalSince1970: 200)
        )
        let readded = CloudSyncSourceEntry(
            key: "same",
            id: sourceID,
            name: "Same",
            baseURL: "https://same.example.test",
            isEnabled: true,
            updatedAt: Date(timeIntervalSince1970: 300),
            deletedAt: nil
        )

        let removed = CloudSyncMerger.merge(
            local: snapshot(entries: [active]),
            cloud: snapshot(entries: [deleted])
        ).snapshot
        XCTAssertTrue(removed.sources.first?.isDeleted == true)

        let restored = CloudSyncMerger.merge(
            local: snapshot(entries: [deleted]),
            cloud: snapshot(entries: [readded])
        ).snapshot
        XCTAssertFalse(restored.sources.first?.isDeleted == true)
    }

    @MainActor
    func testCloudKitUnavailableDoesNotCrashWithoutEntitlement() async {
        let service = CloudSyncService()
        do {
            _ = try await service.sync(local: snapshot(entries: []))
            XCTFail("An unprovisioned test process should not sync with CloudKit")
        } catch let error as CloudSyncError {
            XCTAssertEqual(
                error.localizedDescription,
                "当前版本未配置 CloudKit 权限，请使用 Apple Developer 签名版本"
            )
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    private func snapshot(sourceKeys: [String], updatedAt: Date) -> CloudSyncSnapshot {
        snapshot(entries: sourceKeys.map { key in
            CloudSyncSourceEntry(
                key: key,
                id: UUID(),
                name: key,
                baseURL: "https://\(key).example.test",
                isEnabled: true,
                updatedAt: updatedAt,
                deletedAt: nil
            )
        }, updatedAt: updatedAt)
    }

    private func snapshot(
        entries: [CloudSyncSourceEntry],
        updatedAt: Date = Date(timeIntervalSince1970: 100)
    ) -> CloudSyncSnapshot {
        CloudSyncSnapshot(
            sources: entries,
            preferences: [],
            order: [],
            orderUpdatedAt: updatedAt
        )
    }

    private func preferenceSnapshot(_ preference: CloudSyncPreferenceEntry) -> CloudSyncSnapshot {
        CloudSyncSnapshot(
            sources: [],
            preferences: [preference],
            order: [],
            orderUpdatedAt: preference.updatedAt
        )
    }
}
