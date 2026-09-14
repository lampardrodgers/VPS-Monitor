import CloudKit
import Foundation
import Security

enum CloudSyncStatus: Equatable {
    case disabled
    case syncing
    case waitingForNetwork
    case synced(Date)
    case unavailable(String)
    case failed(String)

    var title: String {
        switch self {
        case .disabled:
            "未启用"
        case .syncing:
            "同步中"
        case .waitingForNetwork:
            "等待网络"
        case .synced:
            "已同步"
        case .unavailable:
            "iCloud 不可用"
        case .failed:
            "同步失败"
        }
    }

    var systemImage: String {
        switch self {
        case .disabled:
            "icloud.slash"
        case .syncing:
            "arrow.triangle.2.circlepath.icloud"
        case .waitingForNetwork:
            "wifi.slash"
        case .synced:
            "checkmark.icloud"
        case .unavailable, .failed:
            "exclamationmark.icloud"
        }
    }

    var detail: String? {
        switch self {
        case .disabled, .syncing, .waitingForNetwork, .synced:
            nil
        case let .unavailable(message), let .failed(message):
            message
        }
    }
}

struct CloudSyncSummary: Equatable, Sendable {
    let localSourceCount: Int
    let cloudSourceCount: Int
    let mergedSourceCount: Int
    let duplicateSourceCount: Int
    let localPreferenceCount: Int
    let cloudPreferenceCount: Int
    let mergedPreferenceCount: Int
    let completedAt: Date

    var text: String {
        "本机 \(localSourceCount) 个、云端 \(cloudSourceCount) 个，合并后 \(mergedSourceCount) 个监控源" +
            (duplicateSourceCount > 0 ? "，去重 \(duplicateSourceCount) 个" : "")
    }
}

struct CloudSyncSourceEntry: Codable, Equatable, Sendable {
    var key: String
    var id: UUID
    var name: String
    var baseURL: String
    var isEnabled: Bool
    var updatedAt: Date
    var deletedAt: Date?

    var isDeleted: Bool { deletedAt != nil }

    func source() -> MonitorSource {
        MonitorSource(id: id, name: name, baseURL: baseURL, isEnabled: isEnabled)
    }
}

struct CloudSyncPreferenceEntry: Codable, Equatable, Sendable {
    var id: String
    var alias: String?
    var countryOverride: String?
    /// `false` means the field may be absent in an older sync record. A
    /// `true` value is only written when the user explicitly cleared a flag.
    /// This lets us preserve old devices' country data without making the
    /// clear action impossible to sync.
    var countryOverrideCleared: Bool
    var manualResetTime: Date?
    var resetDayAnchor: Int?
    var autoAdvance: Bool
    var updatedAt: Date

    init(
        id: String,
        alias: String?,
        countryOverride: String?,
        manualResetTime: Date?,
        resetDayAnchor: Int?,
        autoAdvance: Bool,
        updatedAt: Date,
        countryOverrideCleared: Bool = false
    ) {
        self.id = id
        self.alias = alias
        self.countryOverride = countryOverride
        self.countryOverrideCleared = countryOverrideCleared
        self.manualResetTime = manualResetTime
        self.resetDayAnchor = resetDayAnchor
        self.autoAdvance = autoAdvance
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case alias
        case countryOverride
        case countryOverrideCleared
        case manualResetTime
        case resetDayAnchor
        case autoAdvance
        case updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        alias = try container.decodeIfPresent(String.self, forKey: .alias)
        countryOverride = try container.decodeIfPresent(String.self, forKey: .countryOverride)
        // Older CloudKit records predate this field. Missing means that a
        // nil country value is unspecified, not an explicit clear operation.
        countryOverrideCleared = try container.decodeIfPresent(Bool.self, forKey: .countryOverrideCleared) ?? false
        manualResetTime = try container.decodeIfPresent(Date.self, forKey: .manualResetTime)
        resetDayAnchor = try container.decodeIfPresent(Int.self, forKey: .resetDayAnchor)
        autoAdvance = try container.decode(Bool.self, forKey: .autoAdvance)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
    }
}

struct CloudSyncSnapshot: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int
    var sources: [CloudSyncSourceEntry]
    var preferences: [CloudSyncPreferenceEntry]
    var order: [String]
    var orderUpdatedAt: Date

    static func bootstrap(
        sources: [MonitorSource],
        order: [String],
        aliases: [String: String],
        countryOverrides: [String: String],
        clearedCountryOverrideIDs: Set<String> = [],
        manualResetTimes: [String: Date],
        autoAdvanceResetTimeIDs: Set<String>,
        resetDayAnchors: [String: Int]
    ) -> CloudSyncSnapshot {
        let now = Date()
        let sourceEntries = sources.map {
            CloudSyncSourceEntry(
                key: $0.syncKey,
                id: $0.id,
                name: $0.name,
                baseURL: $0.normalizedBaseURL,
                isEnabled: $0.isEnabled,
                updatedAt: now,
                deletedAt: nil
            )
        }
        var preferenceIDs = Set(aliases.keys)
        preferenceIDs.formUnion(countryOverrides.keys)
        preferenceIDs.formUnion(manualResetTimes.keys)
        preferenceIDs.formUnion(autoAdvanceResetTimeIDs)
        preferenceIDs.formUnion(resetDayAnchors.keys)
        let preferences = preferenceIDs.sorted().map { id in
            CloudSyncPreferenceEntry(
                id: id,
                alias: aliases[id],
                countryOverride: countryOverrides[id],
                manualResetTime: manualResetTimes[id],
                resetDayAnchor: resetDayAnchors[id],
                autoAdvance: autoAdvanceResetTimeIDs.contains(id),
                updatedAt: now,
                countryOverrideCleared: clearedCountryOverrideIDs.contains(id) && countryOverrides[id] == nil
            )
        }
        return CloudSyncSnapshot(
            version: currentVersion,
            sources: sourceEntries,
            preferences: preferences,
            order: order,
            orderUpdatedAt: now
        )
    }

    init(
        version: Int = CloudSyncSnapshot.currentVersion,
        sources: [CloudSyncSourceEntry],
        preferences: [CloudSyncPreferenceEntry],
        order: [String],
        orderUpdatedAt: Date
    ) {
        self.version = version
        self.sources = sources
        self.preferences = preferences
        self.order = order
        self.orderUpdatedAt = orderUpdatedAt
    }
}

struct CloudSyncMergeResult: Sendable {
    let snapshot: CloudSyncSnapshot
    let summary: CloudSyncSummary
}

enum CloudSyncMerger {
    static func migratedSnapshot(
        _ snapshot: CloudSyncSnapshot,
        using mapping: [String: String]
    ) -> CloudSyncSnapshot {
        var preferences: [String: CloudSyncPreferenceEntry] = [:]
        for var entry in snapshot.preferences {
            entry.id = mapping[entry.id] ?? entry.id
            if let existing = preferences[entry.id] {
                preferences[entry.id] = mergePreferenceEntries(existing, entry)
            } else {
                preferences[entry.id] = entry
            }
        }
        return CloudSyncSnapshot(
            version: snapshot.version,
            sources: snapshot.sources,
            preferences: preferences.values.sorted { $0.id < $1.id },
            order: migratedIDs(snapshot.order, using: mapping),
            orderUpdatedAt: snapshot.orderUpdatedAt
        )
    }

    static func merge(
        local: CloudSyncSnapshot,
        cloud: CloudSyncSnapshot?,
        completedAt: Date = Date()
    ) -> CloudSyncMergeResult {
        guard let cloud else {
            return CloudSyncMergeResult(
                snapshot: local,
                summary: CloudSyncSummary(
                    localSourceCount: activeSourceCount(local),
                    cloudSourceCount: 0,
                    mergedSourceCount: activeSourceCount(local),
                    duplicateSourceCount: 0,
                    localPreferenceCount: local.preferences.count,
                    cloudPreferenceCount: 0,
                    mergedPreferenceCount: local.preferences.count,
                    completedAt: completedAt
                )
            )
        }

        var sourcesByKey: [String: CloudSyncSourceEntry] = [:]
        for entry in local.sources {
            sourcesByKey[entry.key] = entry
        }
        for entry in cloud.sources {
            if let existing = sourcesByKey[entry.key] {
                sourcesByKey[entry.key] = preferredSource(existing, entry)
            } else {
                sourcesByKey[entry.key] = entry
            }
        }

        var preferencesByID: [String: CloudSyncPreferenceEntry] = [:]
        for entry in local.preferences {
            preferencesByID[entry.id] = entry
        }
        for entry in cloud.preferences {
            if let existing = preferencesByID[entry.id] {
                preferencesByID[entry.id] = mergePreferenceEntries(existing, entry)
            } else {
                preferencesByID[entry.id] = entry
            }
        }

        let primaryOrder: [String]
        let secondaryOrder: [String]
        if local.orderUpdatedAt >= cloud.orderUpdatedAt {
            primaryOrder = local.order
            secondaryOrder = cloud.order
        } else {
            primaryOrder = cloud.order
            secondaryOrder = local.order
        }
        var mergedOrder: [String] = []
        var seenOrderIDs: Set<String> = []
        for id in primaryOrder + secondaryOrder where seenOrderIDs.insert(id).inserted {
            mergedOrder.append(id)
        }

        let merged = CloudSyncSnapshot(
            version: max(local.version, cloud.version),
            sources: sourcesByKey.values.sorted { $0.key < $1.key },
            preferences: preferencesByID.values.sorted { $0.id < $1.id },
            order: mergedOrder,
            orderUpdatedAt: max(local.orderUpdatedAt, cloud.orderUpdatedAt)
        )
        let localCount = activeSourceCount(local)
        let cloudCount = activeSourceCount(cloud)
        let mergedCount = activeSourceCount(merged)
        return CloudSyncMergeResult(
            snapshot: merged,
            summary: CloudSyncSummary(
                localSourceCount: localCount,
                cloudSourceCount: cloudCount,
                mergedSourceCount: mergedCount,
                duplicateSourceCount: max(0, localCount + cloudCount - mergedCount),
                localPreferenceCount: local.preferences.count,
                cloudPreferenceCount: cloud.preferences.count,
                mergedPreferenceCount: merged.preferences.count,
                completedAt: completedAt
            )
        )
    }

    private static func activeSourceCount(_ snapshot: CloudSyncSnapshot) -> Int {
        snapshot.sources.count(where: { !$0.isDeleted })
    }

    private static func preferredSource(
        _ first: CloudSyncSourceEntry,
        _ second: CloudSyncSourceEntry
    ) -> CloudSyncSourceEntry {
        if let firstDeletedAt = first.deletedAt, firstDeletedAt >= second.updatedAt {
            return first
        }
        if let secondDeletedAt = second.deletedAt, secondDeletedAt >= first.updatedAt {
            return second
        }
        if first.updatedAt > second.updatedAt {
            return first
        }
        return second
    }

    static func mergePreferenceEntries(
        _ first: CloudSyncPreferenceEntry,
        _ second: CloudSyncPreferenceEntry
    ) -> CloudSyncPreferenceEntry {
        let firstIsNewer = first.updatedAt > second.updatedAt
        let newer = firstIsNewer ? first : second
        let older = firstIsNewer ? second : first

        // A nil country value in a pre-flag record means "not recorded". Do
        // not let it erase a real flag. New builds encode an explicit clear
        // separately, so that action still wins when requested by the user.
        let countryOverride: String?
        let countryOverrideCleared: Bool
        if let value = newer.countryOverride {
            countryOverride = value
            countryOverrideCleared = false
        } else if newer.countryOverrideCleared {
            countryOverride = nil
            countryOverrideCleared = true
        } else if let value = older.countryOverride {
            countryOverride = value
            countryOverrideCleared = false
        } else {
            countryOverride = nil
            countryOverrideCleared = older.countryOverrideCleared
        }

        return CloudSyncPreferenceEntry(
            id: newer.id,
            alias: newer.alias ?? older.alias,
            countryOverride: countryOverride,
            manualResetTime: newer.manualResetTime,
            resetDayAnchor: newer.resetDayAnchor,
            autoAdvance: newer.autoAdvance,
            updatedAt: newer.updatedAt,
            countryOverrideCleared: countryOverrideCleared
        )
    }

    private static func migratedIDs(_ ids: [String], using mapping: [String: String]) -> [String] {
        var seen: Set<String> = []
        return ids
            .map { mapping[$0] ?? $0 }
            .filter { seen.insert($0).inserted }
    }
}

enum CloudSyncError: LocalizedError {
    case accountUnavailable(String)
    case networkUnavailable(String)
    case invalidRecord
    case conflictRetryExhausted

    var errorDescription: String? {
        switch self {
        case let .accountUnavailable(message), let .networkUnavailable(message):
            message
        case .invalidRecord:
            "iCloud 同步记录格式无法读取"
        case .conflictRetryExhausted:
            "iCloud 同步发生连续冲突，请稍后重试"
        }
    }
}

@MainActor
final class CloudSyncService {
    static let containerIdentifier = "iCloud.com.lampardrodgers.vpsmonitor.menubar"

    private static let recordType = "VPSMonitorPreferences"
    private static let recordName = "preferences"

    private var container: CKContainer?
    private var database: CKDatabase?
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(container: CKContainer? = nil) {
        self.container = container
        self.database = container?.privateCloudDatabase
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        self.encoder = encoder
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    func sync(
        local: CloudSyncSnapshot,
        legacyIDMapping: [String: String] = [:]
    ) async throws -> CloudSyncMergeResult {
        let (container, database) = try configuredCloudKit()
        try await ensureAccount(container)

        var record = try await fetchRecord(database)
        var cloudSnapshot = try decode(record).map {
            CloudSyncMerger.migratedSnapshot($0, using: legacyIDMapping)
        }
        var merged = CloudSyncMerger.merge(local: local, cloud: cloudSnapshot)

        for _ in 0..<3 {
            let recordToSave = record ?? CKRecord(
                recordType: Self.recordType,
                recordID: CKRecord.ID(recordName: Self.recordName)
            )
            recordToSave["version"] = NSNumber(value: merged.snapshot.version)
            recordToSave["payload"] = try encoder.encode(merged.snapshot) as NSData

            do {
                _ = try await database.save(recordToSave)
                return merged
            } catch let error as CKError where error.code == .serverRecordChanged {
                if let serverRecord = error.serverRecord {
                    record = serverRecord
                } else {
                    record = try await fetchRecord(database)
                }
                cloudSnapshot = try decode(record).map {
                    CloudSyncMerger.migratedSnapshot($0, using: legacyIDMapping)
                }
                merged = CloudSyncMerger.merge(local: local, cloud: cloudSnapshot)
            } catch let error as CKError where error.code == .unknownItem {
                record = nil
            }
        }

        throw CloudSyncError.conflictRetryExhausted
    }

    private func configuredCloudKit() throws -> (CKContainer, CKDatabase) {
        if let container, let database {
            return (container, database)
        }

        guard Self.hasCloudKitEntitlement else {
            throw CloudSyncError.accountUnavailable(
                "当前版本未配置 CloudKit 权限，请使用 Apple Developer 签名版本"
            )
        }

        let container = CKContainer(identifier: Self.containerIdentifier)
        let database = container.privateCloudDatabase
        self.container = container
        self.database = database
        return (container, database)
    }

    private static var hasCloudKitEntitlement: Bool {
        guard let task = SecTaskCreateFromSelf(nil) else { return false }
        return SecTaskCopyValueForEntitlement(
            task,
            "com.apple.developer.icloud-container-identifiers" as CFString,
            nil
        ) != nil
    }

    private func ensureAccount(_ container: CKContainer) async throws {
        do {
            switch try await container.accountStatus() {
            case .available:
                return
            case .noAccount:
                throw CloudSyncError.accountUnavailable("当前 Mac 没有登录 iCloud")
            case .restricted:
                throw CloudSyncError.accountUnavailable("当前 iCloud 账户受到限制")
            case .couldNotDetermine:
                throw CloudSyncError.accountUnavailable("暂时无法确认 iCloud 账户状态")
            case .temporarilyUnavailable:
                throw CloudSyncError.accountUnavailable("iCloud 暂时不可用")
            @unknown default:
                throw CloudSyncError.accountUnavailable("无法确认 iCloud 账户状态")
            }
        } catch let error as CloudSyncError {
            throw error
        } catch let error as CKError {
            throw CloudSyncError.accountUnavailable(message(for: error))
        }
    }

    private func fetchRecord(_ database: CKDatabase) async throws -> CKRecord? {
        do {
            return try await database.record(for: CKRecord.ID(recordName: Self.recordName))
        } catch let error as CKError where error.code == .unknownItem {
            return nil
        } catch let error as CKError {
            if error.code == .networkFailure || error.code == .networkUnavailable {
                throw CloudSyncError.networkUnavailable(message(for: error))
            }
            throw CloudSyncError.accountUnavailable(message(for: error))
        }
    }

    private func decode(_ record: CKRecord?) throws -> CloudSyncSnapshot? {
        guard let record else { return nil }
        let value = record["payload"]
        let data: Data?
        if let value = value as? Data {
            data = value
        } else if let value = value as? NSData {
            data = Data(referencing: value)
        } else {
            data = nil
        }
        guard let data else { throw CloudSyncError.invalidRecord }
        return try decoder.decode(CloudSyncSnapshot.self, from: data)
    }

    private func message(for error: CKError) -> String {
        switch error.code {
        case .notAuthenticated:
            "请先在系统设置中登录 iCloud"
        case .networkFailure, .networkUnavailable:
            "当前没有可用网络，恢复网络后会自动重试"
        case .serviceUnavailable, .requestRateLimited, .accountTemporarilyUnavailable:
            "iCloud 暂时繁忙，稍后会自动重试"
        default:
            error.localizedDescription
        }
    }
}
