import Foundation

enum JSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .bool(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var number: Double? {
        switch self {
        case let .number(value): value
        case let .string(value): Double(value)
        default: nil
        }
    }

    var string: String? {
        switch self {
        case let .string(value): value
        case let .number(value): String(value)
        case let .bool(value): value ? "true" : "false"
        default: nil
        }
    }

    var bool: Bool? {
        switch self {
        case let .bool(value): value
        case let .string(value): Bool(value)
        default: nil
        }
    }
}

struct HealthResponse: Codable, Hashable, Sendable {
    let status: String
    let database: String
    let latestObservationAt: String?
}

struct SummaryResponse: Codable, Hashable, Sendable {
    let generatedAt: String
    let providersTotal: Int
    let providersOk: Int
    let instancesTotal: Int
    let instancesOnline: Int
    let instancesUnlimitedTraffic: Int
    let trafficUsedBytes: Double
    let trafficTotalBytes: Double
}

struct ProviderStatus: Codable, Hashable, Sendable, Identifiable {
    let provider: String
    let ok: Bool
    let instanceCount: Int
    let lastCollectedAt: String?
    let lastError: String?

    var id: String { provider }
}

struct ProviderListResponse: Codable, Hashable, Sendable {
    let items: [ProviderStatus]
}

struct InstanceObservation: Codable, Hashable, Sendable {
    let provider: String
    let instanceKey: String
    let displayName: String
    let observedAt: String
    let status: String?
    let metrics: [String: JSONValue]
    let quota: [String: JSONValue]
    let metadata: [String: JSONValue]
    var countryCode: String? = nil
    var country: String? = nil
}

struct InstanceListResponse: Codable, Hashable, Sendable {
    let total: Int
    let offset: Int
    let limit: Int
    let items: [InstanceObservation]
}

struct AliyunLiveResponse: Codable, Hashable, Sendable {
    let provider: String
    let requestedAt: String
    let completedAt: String
    let durationMs: Int
    let total: Int
    let items: [InstanceObservation]
}

struct HistoryPoint: Codable, Hashable, Sendable {
    let observedAt: String
    let status: String?
    let metrics: [String: JSONValue]
    let quota: [String: JSONValue]
}

struct InstanceHistoryResponse: Codable, Hashable, Sendable {
    let provider: String
    let instanceKey: String
    let hours: Int
    let points: [HistoryPoint]
}

struct MonitorSource: Codable, Hashable, Sendable, Identifiable {
    let id: UUID
    var name: String
    var baseURL: String
    var isEnabled: Bool

    static let local = MonitorSource(
        id: UUID(uuidString: "A11CE000-0000-4000-8000-000000000001")!,
        name: "本机隧道",
        baseURL: "http://127.0.0.1:8787",
        isEnabled: true
    )

    var normalizedBaseURL: String {
        baseURL.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(
            of: #"/+$"#,
            with: "",
            options: .regularExpression
        )
    }
}

struct MonitoredInstance: Codable, Hashable, Sendable, Identifiable {
    let source: MonitorSource
    let observation: InstanceObservation

    var id: String { "\(source.id.uuidString)|\(observation.provider)|\(observation.instanceKey)" }
}

struct SourceSnapshot: Sendable {
    let source: MonitorSource
    let health: HealthResponse
    let summary: SummaryResponse
    let providers: [ProviderStatus]
    let instances: [MonitoredInstance]
}

extension JSONDecoder {
    static var vpsMonitor: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

extension JSONEncoder {
    static var vpsMonitor: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}
