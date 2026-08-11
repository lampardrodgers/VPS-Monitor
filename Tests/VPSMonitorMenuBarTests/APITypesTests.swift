import XCTest
@testable import VPSMonitorMenuBar

final class APITypesTests: XCTestCase {
    func testLiveLocalAPIWhenRequested() async throws {
        guard ProcessInfo.processInfo.environment["RUN_LIVE_API_TESTS"] == "1" else {
            throw XCTSkip("Set RUN_LIVE_API_TESTS=1 when the local SSH tunnel is available")
        }
        let client = try APIClient(baseURL: "http://127.0.0.1:8787")
        let snapshot = try await client.fetchSnapshot(source: .local)
        XCTAssertEqual(snapshot.health.status, "ok")
        XCTAssertFalse(snapshot.instances.isEmpty)
        XCTAssertGreaterThan(snapshot.summary.instancesTotal, 0)

        let live = try await client.fetchAliyunLive()
        XCTAssertEqual(live.provider, "aliyun_swas")
        XCTAssertFalse(live.items.isEmpty)
        XCTAssertGreaterThanOrEqual(live.durationMs, 0)
    }

    func testDecodesAliyunLiveResponse() throws {
        let data = Data(#"""
        {
          "provider":"aliyun_swas",
          "requested_at":"2026-08-10T07:24:47+00:00",
          "completed_at":"2026-08-10T07:24:50+00:00",
          "duration_ms":2690,
          "total":1,
          "items":[{
            "provider":"aliyun_swas",
            "instance_key":"demo-instance-001",
            "display_name":"Example SWAS",
            "observed_at":"2026-08-10T07:24:50+00:00",
            "status":"Running",
            "metrics":{"cpu_percent":5.1},
            "quota":{"traffic_unlimited":true},
            "metadata":{"region_id":"example-region-2"}
          }]
        }
        """#.utf8)

        let value = try JSONDecoder.vpsMonitor.decode(AliyunLiveResponse.self, from: data)
        XCTAssertEqual(value.durationMs, 2_690)
        XCTAssertEqual(value.items.first?.metric("cpu_percent"), 5.1)
        XCTAssertEqual(value.items.first?.observedAt, value.completedAt)
    }

    func testDecodesDocumentedInstanceWithoutTreatingMissingValuesAsZero() throws {
        let data = Data(#"""
        {
          "provider":"panstar",
          "instance_key":"demo-instance-002",
          "display_name":"Example VPS",
          "country_code":"JP",
          "observed_at":"2026-08-10T03:30:17+00:00",
          "status":"READY",
          "metrics":{"memory_total_bytes":536870912},
          "quota":{"traffic_unlimited":true},
          "metadata":{"cpu_cores":1,"region":"example-region-1"}
        }
        """#.utf8)

        let value = try JSONDecoder.vpsMonitor.decode(InstanceObservation.self, from: data)

        XCTAssertEqual(value.instanceKey, "demo-instance-002")
        XCTAssertEqual(value.countryCode, "JP")
        XCTAssertEqual(value.normalizedState, .online)
        XCTAssertEqual(value.metric("memory_total_bytes"), 536_870_912)
        XCTAssertNil(value.metric("cpu_percent"))
        XCTAssertEqual(value.quota["traffic_unlimited"]?.bool, true)
    }

    func testDecodesSummarySnakeCaseKeys() throws {
        let data = Data(#"""
        {
          "generated_at":"2026-08-10T03:30:30+00:00",
          "providers_total":5,
          "providers_ok":5,
          "instances_total":6,
          "instances_online":6,
          "instances_unlimited_traffic":1,
          "traffic_used_bytes":2147483648,
          "traffic_total_bytes":1099511627776
        }
        """#.utf8)

        let value = try JSONDecoder.vpsMonitor.decode(SummaryResponse.self, from: data)
        XCTAssertEqual(value.instancesTotal, 6)
        XCTAssertEqual(value.trafficTotalBytes, 1_099_511_627_776)
    }

    func testRetentionSettingsUseSnakeCaseKeys() throws {
        let data = Data(#"""
        {
          "history_retention_days":14,
          "run_retention_days":60,
          "updated_at":"2026-08-11T00:00:00+00:00"
        }
        """#.utf8)

        let value = try JSONDecoder.vpsMonitor.decode(RetentionSettings.self, from: data)
        XCTAssertEqual(value.historyRetentionDays, 14)
        XCTAssertEqual(value.runRetentionDays, 60)

        let encoded = try JSONEncoder.vpsMonitor.encode(
            RetentionSettingsUpdate(historyRetentionDays: 30, runRetentionDays: 90)
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Int])
        XCTAssertEqual(object["history_retention_days"], 30)
        XCTAssertEqual(object["run_retention_days"], 90)
    }
}
