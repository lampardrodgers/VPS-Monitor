import Combine
import CloudKit
import Foundation
import Network

@MainActor
final class MonitorStore: ObservableObject {
    @Published private(set) var sources: [MonitorSource]
    @Published private(set) var instances: [MonitoredInstance]
    @Published private(set) var summaries: [UUID: SummaryResponse] = [:]
    @Published private(set) var providers: [UUID: [ProviderStatus]] = [:]
    @Published private(set) var sourceErrors: [UUID: String] = [:]
    @Published private(set) var isRefreshing = false
    @Published private(set) var lastRefreshAt: Date?
    @Published private(set) var liveRefreshSchedule: LiveRefreshSchedule
    @Published private(set) var isRefreshingAliyun = false
    @Published private(set) var liveRefreshError: String?
    @Published private(set) var lastAliyunLiveAt: Date?
    @Published private(set) var lastAliyunDurationMs: Int?
    @Published private(set) var manualResetTimes: [String: Date]
    @Published private(set) var instanceAliases: [String: String]
    @Published private(set) var autoAdvanceResetTimeIDs: Set<String>
    @Published private(set) var countryOverrides: [String: String]
    @Published private(set) var cloudSyncEnabled: Bool
    @Published private(set) var cloudSyncStatus: CloudSyncStatus
    @Published private(set) var lastCloudSyncAt: Date?
    @Published private(set) var cloudSyncSummary: CloudSyncSummary?

    private var order: [String]
    private var resetDayAnchors: [String: Int]
    private var liveRefreshTask: Task<Void, Never>?
    private var cloudSyncLoopTask: Task<Void, Never>?
    private var cloudSyncDebounceTask: Task<Void, Never>?
    private var networkMonitor: NWPathMonitor?
    private var networkIsAvailable = true
    private var cloudSyncFailureCount = 0
    private var nextCloudSyncRetryAt: Date?
    private var isApplyingCloudSync = false
    private var syncSnapshot: CloudSyncSnapshot
    private var clearedCountryOverrideIDs: Set<String>
    private let cloudSyncService = CloudSyncService()
    private let sshTunnel = EphemeralSSHTunnel()
    private let defaults: UserDefaults
    private let sourcesKey = "monitor.sources.v1"
    private let instancesKey = "monitor.cachedInstances.v1"
    private let orderKey = "monitor.instanceOrder.v1"
    private let liveScheduleKey = "monitor.aliyunLiveSchedule.v1"
    private let manualResetTimesKey = "monitor.manualResetTimes.v1"
    private let aliasesKey = "monitor.instanceAliases.v1"
    private let autoAdvanceResetTimesKey = "monitor.autoAdvanceResetTimes.v1"
    private let resetDayAnchorsKey = "monitor.resetDayAnchors.v1"
    private let countryOverridesKey = "monitor.countryOverrides.v1"
    private let clearedCountryOverridesKey = "monitor.clearedCountryOverrides.v1"
    private let syncSnapshotKey = "monitor.cloudSyncSnapshot.v1"
    private let cloudSyncEnabledKey = "monitor.cloudSyncEnabled.v1"
    private let lastCloudSyncAtKey = "monitor.lastCloudSyncAt.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        cloudSyncEnabled = false
        cloudSyncStatus = .disabled
        lastCloudSyncAt = nil
        cloudSyncSummary = nil
        syncSnapshot = CloudSyncSnapshot(
            sources: [],
            preferences: [],
            order: [],
            orderUpdatedAt: .distantPast
        )
        if let data = defaults.data(forKey: sourcesKey),
           let decoded = try? JSONDecoder.vpsMonitor.decode([MonitorSource].self, from: data),
           !decoded.isEmpty {
            sources = decoded
        } else {
            sources = [.local]
        }
        if let data = defaults.data(forKey: instancesKey),
           let decoded = try? JSONDecoder.vpsMonitor.decode([MonitoredInstance].self, from: data) {
            instances = decoded
        } else {
            instances = []
        }
        if let data = defaults.data(forKey: liveScheduleKey),
           let decoded = try? JSONDecoder.vpsMonitor.decode(LiveRefreshSchedule.self, from: data) {
            liveRefreshSchedule = decoded
        } else {
            liveRefreshSchedule = .defaultValue
        }
        if let data = defaults.data(forKey: manualResetTimesKey),
           let decoded = try? JSONDecoder.vpsMonitor.decode([String: Date].self, from: data) {
            manualResetTimes = decoded
        } else {
            manualResetTimes = [:]
        }
        if let data = defaults.data(forKey: aliasesKey),
           let decoded = try? JSONDecoder.vpsMonitor.decode([String: String].self, from: data) {
            instanceAliases = decoded
        } else {
            instanceAliases = [:]
        }
        autoAdvanceResetTimeIDs = Set(defaults.stringArray(forKey: autoAdvanceResetTimesKey) ?? [])
        if let data = defaults.data(forKey: resetDayAnchorsKey),
           let decoded = try? JSONDecoder.vpsMonitor.decode([String: Int].self, from: data) {
            resetDayAnchors = decoded
        } else {
            resetDayAnchors = [:]
        }
        if let data = defaults.data(forKey: countryOverridesKey),
           let decoded = try? JSONDecoder.vpsMonitor.decode([String: String].self, from: data) {
            countryOverrides = decoded
        } else {
            countryOverrides = [:]
        }
        clearedCountryOverrideIDs = Set(defaults.stringArray(forKey: clearedCountryOverridesKey) ?? [])
        order = defaults.stringArray(forKey: orderKey) ?? []

        let legacyToStableID = Self.instanceIDMigrationMap(for: instances)
        order = Self.migrateIDs(order, using: legacyToStableID)
        manualResetTimes = Self.migrateDictionary(manualResetTimes, using: legacyToStableID)
        instanceAliases = Self.migrateDictionary(instanceAliases, using: legacyToStableID)
        countryOverrides = Self.migrateDictionary(countryOverrides, using: legacyToStableID)
        clearedCountryOverrideIDs = Set(Self.migrateIDs(Array(clearedCountryOverrideIDs), using: legacyToStableID))
        resetDayAnchors = Self.migrateDictionary(resetDayAnchors, using: legacyToStableID)
        autoAdvanceResetTimeIDs = Set(Self.migrateIDs(Array(autoAdvanceResetTimeIDs), using: legacyToStableID))

        if let data = defaults.data(forKey: syncSnapshotKey),
           let decoded = try? Self.syncDecoder.decode(CloudSyncSnapshot.self, from: data) {
            syncSnapshot = CloudSyncMerger.migratedSnapshot(decoded, using: legacyToStableID)
        } else {
            syncSnapshot = CloudSyncSnapshot.bootstrap(
                sources: sources,
                order: order,
                aliases: instanceAliases,
                countryOverrides: countryOverrides,
                clearedCountryOverrideIDs: clearedCountryOverrideIDs,
                manualResetTimes: manualResetTimes,
                autoAdvanceResetTimeIDs: autoAdvanceResetTimeIDs,
                resetDayAnchors: resetDayAnchors
            )
        }
        cloudSyncEnabled = defaults.bool(forKey: cloudSyncEnabledKey)
        lastCloudSyncAt = defaults.object(forKey: lastCloudSyncAtKey) as? Date
        if cloudSyncEnabled, let lastCloudSyncAt {
            cloudSyncStatus = .synced(lastCloudSyncAt)
        } else {
            cloudSyncStatus = cloudSyncEnabled ? .waitingForNetwork : .disabled
        }
        instances = Self.sorted(instances, using: order)
        advanceExpiredResetTimes()
        // Persist the migrated representation immediately. This prevents an
        // older CloudKit payload from being reintroduced on the next launch.
        persistPreferenceValues()
        persistSyncSnapshot()
    }

    deinit {
        liveRefreshTask?.cancel()
        cloudSyncLoopTask?.cancel()
        cloudSyncDebounceTask?.cancel()
        networkMonitor?.cancel()
    }

    var totalCount: Int { instances.count }
    var onlineCount: Int { instances.filter { $0.observation.normalizedState == .online }.count }
    var staleCount: Int { instances.filter(\.observation.isStale).count }

    var providersSummary: (ok: Int, total: Int) {
        let values = providers.values.flatMap { $0 }
        return (values.filter(\.ok).count, values.count)
    }

    var trafficSummary: (used: Double, total: Double, unlimited: Int) {
        let values = summaries.values
        return (
            values.reduce(0) { $0 + $1.trafficUsedBytes },
            values.reduce(0) { $0 + $1.trafficTotalBytes },
            values.reduce(0) { $0 + $1.instancesUnlimitedTraffic }
        )
    }

    var connectionMessage: String? {
        guard !sourceErrors.isEmpty else { return nil }
        let enabledCount = sources.filter(\.isEnabled).count
        if enabledCount > 0, sourceErrors.count >= enabledCount {
            return "临时 SSH 连接失败或监控 API 未启动"
        }
        return "部分监控源暂时不可用，正在显示上次成功数据"
    }

    func startCloudSyncLoop() {
        guard cloudSyncEnabled, cloudSyncLoopTask == nil else { return }
        startNetworkMonitor()
        cloudSyncLoopTask = Task { [weak self] in
            guard let self else { return }
            await self.performCloudSync(trigger: .launch)
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(60))
                } catch {
                    return
                }
                await self.performScheduledCloudSyncIfNeeded()
            }
        }
    }

    func setCloudSyncEnabled(_ enabled: Bool) {
        guard cloudSyncEnabled != enabled else { return }
        cloudSyncEnabled = enabled
        defaults.set(enabled, forKey: cloudSyncEnabledKey)

        if enabled {
            cloudSyncStatus = .waitingForNetwork
            startCloudSyncLoop()
            scheduleCloudSyncAfterLocalChange(delay: 0.1)
        } else {
            cloudSyncLoopTask?.cancel()
            cloudSyncLoopTask = nil
            cloudSyncDebounceTask?.cancel()
            cloudSyncDebounceTask = nil
            networkMonitor?.cancel()
            networkMonitor = nil
            networkIsAvailable = true
            nextCloudSyncRetryAt = nil
            cloudSyncStatus = .disabled
        }
    }

    func syncCloudPreferencesNow() async {
        guard cloudSyncEnabled else {
            cloudSyncStatus = .disabled
            return
        }
        await performCloudSync(trigger: .manual)
    }

    private func performScheduledCloudSyncIfNeeded() async {
        guard cloudSyncEnabled else { return }
        let now = Date()
        if let retryAt = nextCloudSyncRetryAt {
            guard retryAt <= now else { return }
            await performCloudSync(trigger: .retry)
            return
        }

        let today = Calendar.current.startOfDay(for: now)
        if lastCloudSyncAt == nil || lastCloudSyncAt! < today {
            await performCloudSync(trigger: .daily)
        }
    }

    private func performCloudSync(trigger: CloudSyncTrigger) async {
        guard cloudSyncEnabled else { return }
        guard cloudSyncStatus != .syncing else { return }
        if trigger != .launch, trigger != .manual, !networkIsAvailable {
            cloudSyncStatus = .waitingForNetwork
            return
        }

        cloudSyncStatus = .syncing
        let localSnapshot = makeLocalSyncSnapshot()
        do {
            let result = try await cloudSyncService.sync(
                local: localSnapshot,
                legacyIDMapping: Self.instanceIDMigrationMap(for: instances)
            )
            let sourcesBefore = sources
            applyCloudSyncSnapshot(result.snapshot)
            cloudSyncSummary = result.summary
            lastCloudSyncAt = result.summary.completedAt
            defaults.set(lastCloudSyncAt, forKey: lastCloudSyncAtKey)
            cloudSyncFailureCount = 0
            nextCloudSyncRetryAt = nil
            cloudSyncStatus = .synced(result.summary.completedAt)

            if sourcesBefore != sources {
                await refresh()
            }
        } catch {
            cloudSyncFailureCount = min(cloudSyncFailureCount + 1, 7)
            let retrySeconds = min(3_600.0, 30.0 * pow(2.0, Double(cloudSyncFailureCount - 1)))
            nextCloudSyncRetryAt = Date().addingTimeInterval(retrySeconds)
            if let syncError = error as? CloudSyncError,
               case .accountUnavailable = syncError {
                nextCloudSyncRetryAt = Date().addingTimeInterval(86_400)
            }
            handleCloudSyncError(error)
        }
    }

    private func handleCloudSyncError(_ error: Error) {
        if let error = error as? CloudSyncError {
            switch error {
            case .networkUnavailable:
                cloudSyncStatus = .waitingForNetwork
            case .accountUnavailable:
                cloudSyncStatus = .unavailable(error.localizedDescription)
            case .invalidRecord, .conflictRetryExhausted:
                cloudSyncStatus = .failed(error.localizedDescription)
            }
            return
        }
        if let error = error as? CKError,
           error.code == .networkFailure || error.code == .networkUnavailable {
            cloudSyncStatus = .waitingForNetwork
        } else {
            cloudSyncStatus = .failed(error.localizedDescription)
        }
    }

    private func startNetworkMonitor() {
        guard networkMonitor == nil else { return }
        let monitor = NWPathMonitor()
        networkMonitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self else { return }
                let recovered = available && !self.networkIsAvailable
                self.networkIsAvailable = available
                guard recovered, self.cloudSyncEnabled else { return }
                self.scheduleCloudSyncAfterLocalChange(delay: 2)
            }
        }
        monitor.start(queue: DispatchQueue(label: "VPSMonitor.CloudSync.Network"))
    }

    private func scheduleCloudSyncAfterLocalChange(delay: TimeInterval = 2) {
        guard cloudSyncEnabled, !isApplyingCloudSync else { return }
        cloudSyncDebounceTask?.cancel()
        cloudSyncDebounceTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(delay))
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            await self?.performCloudSync(trigger: .localChange)
        }
    }

    func refresh() async {
        advanceExpiredResetTimes()
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        let enabled = sources.filter(\.isEnabled)
        if enabled.isEmpty {
            sourceErrors = [:]
            return
        }

        let tunnelSources = enabled.filter { sshTunnel.requiresTunnel(for: $0) }
        var acquiredTunnel = false
        var initialResults: [FetchResult] = []
        do {
            acquiredTunnel = try await sshTunnel.acquireIfNeeded(for: tunnelSources)
        } catch {
            initialResults = tunnelSources.map {
                .failure($0.id, "临时 SSH 连接失败：\(error.localizedDescription)")
            }
        }
        defer { sshTunnel.release(acquiredTunnel) }

        let blockedSourceIDs = Set(initialResults.compactMap(\.failedSourceID))
        let fetchableSources = enabled.filter { !blockedSourceIDs.contains($0.id) }
        let fetchedResults = await withTaskGroup(of: FetchResult.self, returning: [FetchResult].self) { group in
            for source in fetchableSources {
                group.addTask {
                    do {
                        let client = try APIClient(baseURL: source.normalizedBaseURL)
                        return .success(try await client.fetchSnapshot(source: source))
                    } catch {
                        return .failure(source.id, error.localizedDescription)
                    }
                }
            }
            var collected: [FetchResult] = []
            for await result in group { collected.append(result) }
            return collected
        }
        let results = initialResults + fetchedResults

        var nextInstances = instances.filter { cached in
            !enabled.contains(where: { $0.id == cached.source.id })
        }
        var nextErrors: [UUID: String] = [:]

        for result in results {
            switch result {
            case let .success(snapshot):
                nextInstances.removeAll { $0.source.id == snapshot.source.id }
                nextInstances.append(contentsOf: snapshot.instances)
                summaries[snapshot.source.id] = snapshot.summary
                providers[snapshot.source.id] = snapshot.providers
            case let .failure(sourceID, message):
                nextErrors[sourceID] = message
                nextInstances.append(contentsOf: instances.filter { $0.source.id == sourceID })
            }
        }

        sourceErrors = nextErrors
        let incoming = Self.unique(nextInstances)
        instances = Self.sorted(
            Self.preservingNewerAliyun(existing: instances, incoming: incoming),
            using: order
        )
        migratePreferenceIDsToCurrentInstances()
        lastRefreshAt = .now
        persistCache()
    }

    func refreshAll() async {
        await refresh()
        await refreshAliyunLive()
    }

    func startLiveRefreshLoop() {
        guard liveRefreshTask == nil else { return }
        liveRefreshTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let cycleStartedAt = Date()
                await self.refreshAliyunLive()
                let elapsed = Date().timeIntervalSince(cycleStartedAt)
                let waitSeconds = max(0.25, Double(self.liveRefreshSchedule.seconds) - elapsed)
                do {
                    try await Task.sleep(for: .seconds(waitSeconds))
                } catch {
                    return
                }
            }
        }
    }

    func setLiveRefreshSchedule(_ schedule: LiveRefreshSchedule) {
        liveRefreshSchedule = schedule
        if let data = try? JSONEncoder.vpsMonitor.encode(schedule) {
            defaults.set(data, forKey: liveScheduleKey)
        }
        liveRefreshTask?.cancel()
        liveRefreshTask = nil
        startLiveRefreshLoop()
    }

    func refreshAliyunLive() async {
        advanceExpiredResetTimes()
        guard !isRefreshingAliyun else { return }
        let enabled = sources.filter(\.isEnabled)
        guard !enabled.isEmpty else { return }

        isRefreshingAliyun = true
        defer { isRefreshingAliyun = false }

        let tunnelSources = enabled.filter { sshTunnel.requiresTunnel(for: $0) }
        var acquiredTunnel = false
        var initialResults: [LiveFetchResult] = []
        do {
            acquiredTunnel = try await sshTunnel.acquireIfNeeded(for: tunnelSources)
        } catch {
            initialResults = tunnelSources.map {
                .failure($0.name, "临时 SSH 连接失败：\(error.localizedDescription)")
            }
        }
        defer { sshTunnel.release(acquiredTunnel) }

        let blockedSourceIDs = initialResults.isEmpty ? Set<UUID>() : Set(tunnelSources.map(\.id))
        let fetchableSources = enabled.filter { !blockedSourceIDs.contains($0.id) }
        let fetchedResults = await withTaskGroup(of: LiveFetchResult.self, returning: [LiveFetchResult].self) { group in
            for source in fetchableSources {
                group.addTask {
                    do {
                        let client = try APIClient(baseURL: source.normalizedBaseURL)
                        return .success(source, try await client.fetchAliyunLive())
                    } catch is CancellationError {
                        return .cancelled
                    } catch {
                        return .failure(source.name, error.localizedDescription)
                    }
                }
            }
            var collected: [LiveFetchResult] = []
            for await result in group { collected.append(result) }
            return collected
        }
        let results = initialResults + fetchedResults

        if Task.isCancelled { return }
        var nextInstances = instances
        var errors: [String] = []
        var successCount = 0
        var newestCompletedAt = lastAliyunLiveAt
        var latestDuration = lastAliyunDurationMs

        for result in results {
            switch result {
            case let .success(source, response):
                successCount += 1
                for observation in response.items {
                    let incoming = MonitoredInstance(source: source, observation: observation)
                    if let index = nextInstances.firstIndex(where: { $0.id == incoming.id }) {
                        nextInstances[index] = incoming
                    } else {
                        nextInstances.append(incoming)
                    }
                }
                if let completedAt = VPSFormat.date(response.completedAt),
                   newestCompletedAt == nil || completedAt > newestCompletedAt! {
                    newestCompletedAt = completedAt
                    latestDuration = response.durationMs
                }
            case let .failure(sourceName, message):
                errors.append("\(sourceName)：\(message)")
            case .cancelled:
                break
            }
        }

        if successCount > 0 {
            instances = Self.sorted(Self.unique(nextInstances), using: order)
            migratePreferenceIDsToCurrentInstances()
            lastAliyunLiveAt = newestCompletedAt ?? .now
            lastAliyunDurationMs = latestDuration
            liveRefreshError = errors.isEmpty ? nil : "部分监控源的阿里云实时查询失败"
            persistCache()
        } else if let firstError = errors.first {
            liveRefreshError = firstError
        }
    }

    func addSource(name: String, baseURL: String) async throws {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate = MonitorSource(
            id: UUID(),
            name: trimmedName.isEmpty ? "监控源 \(sources.count + 1)" : trimmedName,
            baseURL: baseURL,
            isEnabled: true
        )
        guard !sources.contains(where: { $0.normalizedBaseURL.caseInsensitiveCompare(candidate.normalizedBaseURL) == .orderedSame }) else {
            throw SourceError.duplicate
        }
        let acquiredTunnel = try await sshTunnel.acquireIfNeeded(for: [candidate])
        defer { sshTunnel.release(acquiredTunnel) }
        let client = try APIClient(baseURL: candidate.normalizedBaseURL)
        let snapshot = try await client.fetchSnapshot(source: candidate)
        sources.append(candidate)
        persistSources()
        summaries[candidate.id] = snapshot.summary
        providers[candidate.id] = snapshot.providers
        instances.append(contentsOf: snapshot.instances)
        instances = Self.sorted(Self.unique(instances), using: order)
        sourceErrors[candidate.id] = nil
        lastRefreshAt = .now
        persistCache()
    }

    func removeSource(_ source: MonitorSource) {
        sources.removeAll { $0.id == source.id }
        instances.removeAll { $0.source.id == source.id }
        summaries[source.id] = nil
        providers[source.id] = nil
        sourceErrors[source.id] = nil
        persistSources()
        persistCache()
    }

    func setSource(_ source: MonitorSource, enabled: Bool) {
        guard let index = sources.firstIndex(where: { $0.id == source.id }) else { return }
        sources[index].isEnabled = enabled
        if !enabled { sourceErrors[source.id] = nil }
        persistSources()
    }

    func testDefaultSSHConnection() async throws {
        let source = sources.first(where: { sshTunnel.requiresTunnel(for: $0) }) ?? .local
        let acquiredTunnel = try await sshTunnel.acquireIfNeeded(for: [source])
        defer { sshTunnel.release(acquiredTunnel) }
        let client = try APIClient(baseURL: source.normalizedBaseURL)
        _ = try await client.fetchHealth()
    }

    /// Moves continuously as the pointer enters another row. When dragging
    /// downward, the item lands after the row under the pointer; upward it
    /// lands before it, matching the native macOS list interaction.
    func moveInstance(_ draggedID: String, to targetID: String) {
        var ids = instances.map(\.id)
        guard let sourceIndex = ids.firstIndex(of: draggedID), let targetIndex = ids.firstIndex(of: targetID),
              sourceIndex != targetIndex else { return }
        let moved = ids.remove(at: sourceIndex)
        let insertionIndex = min(targetIndex, ids.count)
        ids.insert(moved, at: insertionIndex)
        applyOrder(ids)
    }

    func moveInstance(_ instanceID: String, by offset: Int) {
        var ids = instances.map(\.id)
        guard let sourceIndex = ids.firstIndex(of: instanceID) else { return }
        let destinationIndex = sourceIndex + offset
        guard ids.indices.contains(destinationIndex) else { return }
        ids.swapAt(sourceIndex, destinationIndex)
        applyOrder(ids)
    }

    func manualResetTime(for instance: MonitoredInstance) -> Date? {
        manualResetTimes[instance.id]
    }

    func alias(for instance: MonitoredInstance) -> String? {
        instanceAliases[instance.id]
    }

    func displayName(for instance: MonitoredInstance) -> String {
        alias(for: instance) ?? instance.observation.displayName
    }

    func setAlias(_ alias: String?, for instance: MonitoredInstance) {
        let trimmed = alias?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        instanceAliases[instance.id] = trimmed.isEmpty ? nil : trimmed
        if let data = try? JSONEncoder.vpsMonitor.encode(instanceAliases) {
            defaults.set(data, forKey: aliasesKey)
        }
        scheduleCloudSyncAfterLocalChange()
    }

    func apiCountryCode(for instance: MonitoredInstance) -> String? {
        CountryCatalog.apiCountryCode(for: instance.observation)
    }

    func countryOverride(for instance: MonitoredInstance) -> String? {
        countryOverrides[instance.id]
    }

    func effectiveCountryCode(for instance: MonitoredInstance) -> String? {
        countryOverride(for: instance) ?? apiCountryCode(for: instance)
    }

    func setCountryOverride(_ countryCode: String?, for instance: MonitoredInstance) {
        let normalized = countryCode?.uppercased()
        if let normalized, CountryCatalog.country(for: normalized) != nil {
            countryOverrides[instance.id] = normalized
            clearedCountryOverrideIDs.remove(instance.id)
        } else {
            countryOverrides[instance.id] = nil
            clearedCountryOverrideIDs.insert(instance.id)
        }
        if let data = try? JSONEncoder.vpsMonitor.encode(countryOverrides) {
            defaults.set(data, forKey: countryOverridesKey)
        }
        defaults.set(Array(clearedCountryOverrideIDs).sorted(), forKey: clearedCountryOverridesKey)
        scheduleCloudSyncAfterLocalChange()
    }

    func effectiveResetTime(for instance: MonitoredInstance) -> Date? {
        if let manual = manualResetTime(for: instance) { return manual }
        return VPSFormat.date(instance.observation.quota["traffic_reset_at"]?.string)
    }

    func setManualResetTime(_ date: Date?, for instance: MonitoredInstance) {
        if let date {
            let minute = Calendar.current.date(bySetting: .second, value: 0, of: date) ?? date
            manualResetTimes[instance.id] = minute
            resetDayAnchors[instance.id] = Calendar.current.component(.day, from: minute)
        } else {
            manualResetTimes[instance.id] = nil
            resetDayAnchors[instance.id] = nil
            autoAdvanceResetTimeIDs.remove(instance.id)
        }
        persistResetTimePreferences()
    }

    func isResetAutoAdvanceEnabled(for instance: MonitoredInstance) -> Bool {
        autoAdvanceResetTimeIDs.contains(instance.id)
    }

    func setResetAutoAdvanceEnabled(_ enabled: Bool, for instance: MonitoredInstance) {
        if enabled, manualResetTimes[instance.id] != nil {
            autoAdvanceResetTimeIDs.insert(instance.id)
        } else {
            autoAdvanceResetTimeIDs.remove(instance.id)
        }
        persistResetTimePreferences()
        advanceExpiredResetTimes()
    }

    func advanceExpiredResetTimes(now: Date = .now, calendar: Calendar = .current) {
        var updated = manualResetTimes
        var changed = false

        for instanceID in autoAdvanceResetTimeIDs {
            guard var resetDate = updated[instanceID], resetDate <= now else { continue }
            let anchorDay = resetDayAnchors[instanceID] ?? calendar.component(.day, from: resetDate)
            var iterations = 0
            while resetDate <= now, iterations < 1_200 {
                guard let nextDate = Self.nextMonthlyResetDate(
                    after: resetDate,
                    anchorDay: anchorDay,
                    calendar: calendar
                ), nextDate > resetDate else { break }
                resetDate = nextDate
                iterations += 1
            }
            if resetDate != updated[instanceID] {
                updated[instanceID] = resetDate
                changed = true
            }
        }

        guard changed else { return }
        manualResetTimes = updated
        persistResetTimePreferences()
    }

    static func nextMonthlyResetDate(
        after date: Date,
        anchorDay: Int,
        calendar inputCalendar: Calendar = .current
    ) -> Date? {
        var calendar = inputCalendar
        calendar.timeZone = inputCalendar.timeZone
        let source = calendar.dateComponents([.year, .month, .hour, .minute, .second], from: date)
        guard let sourceYear = source.year, let sourceMonth = source.month else { return nil }

        let targetMonth = sourceMonth == 12 ? 1 : sourceMonth + 1
        let targetYear = sourceMonth == 12 ? sourceYear + 1 : sourceYear
        var monthStartComponents = DateComponents()
        monthStartComponents.timeZone = calendar.timeZone
        monthStartComponents.year = targetYear
        monthStartComponents.month = targetMonth
        monthStartComponents.day = 1
        monthStartComponents.hour = 12
        guard let monthStart = calendar.date(from: monthStartComponents),
              let validDays = calendar.range(of: .day, in: .month, for: monthStart) else { return nil }

        var target = DateComponents()
        target.timeZone = calendar.timeZone
        target.year = targetYear
        target.month = targetMonth
        target.day = min(max(anchorDay, validDays.lowerBound), validDays.upperBound - 1)
        target.hour = source.hour
        target.minute = source.minute
        target.second = source.second
        return calendar.date(from: target)
    }

    private func persistResetTimePreferences() {
        if let data = try? JSONEncoder.vpsMonitor.encode(manualResetTimes) {
            defaults.set(data, forKey: manualResetTimesKey)
        }
        if let data = try? JSONEncoder.vpsMonitor.encode(resetDayAnchors) {
            defaults.set(data, forKey: resetDayAnchorsKey)
        }
        defaults.set(Array(autoAdvanceResetTimeIDs).sorted(), forKey: autoAdvanceResetTimesKey)
        scheduleCloudSyncAfterLocalChange()
    }

    private func applyOrder(_ ids: [String]) {
        order = ids
        defaults.set(ids, forKey: orderKey)
        instances = Self.sorted(instances, using: order)
        scheduleCloudSyncAfterLocalChange()
    }

    func fetchHistory(for instance: MonitoredInstance, hours: Int) async throws -> InstanceHistoryResponse {
        let acquiredTunnel = try await sshTunnel.acquireIfNeeded(for: [instance.source])
        defer { sshTunnel.release(acquiredTunnel) }
        let client = try APIClient(baseURL: instance.source.normalizedBaseURL)
        return try await client.fetchHistory(
            provider: instance.observation.provider,
            instanceKey: instance.observation.instanceKey,
            hours: hours
        )
    }

    func fetchRetentionSettings(for source: MonitorSource) async throws -> RetentionSettings {
        let acquiredTunnel = try await sshTunnel.acquireIfNeeded(for: [source])
        defer { sshTunnel.release(acquiredTunnel) }
        let client = try APIClient(baseURL: source.normalizedBaseURL)
        return try await client.fetchRetentionSettings()
    }

    func updateRetentionSettings(
        for source: MonitorSource,
        historyDays: Int,
        runDays: Int
    ) async throws -> RetentionSettings {
        let acquiredTunnel = try await sshTunnel.acquireIfNeeded(for: [source])
        defer { sshTunnel.release(acquiredTunnel) }
        let client = try APIClient(baseURL: source.normalizedBaseURL)
        return try await client.updateRetentionSettings(
            RetentionSettingsUpdate(
                historyRetentionDays: historyDays,
                runRetentionDays: runDays
            )
        )
    }

    private func makeLocalSyncSnapshot() -> CloudSyncSnapshot {
        let now = Date()
        let migration = Self.instanceIDMigrationMap(for: instances)
        syncSnapshot = CloudSyncMerger.migratedSnapshot(syncSnapshot, using: migration)
        var sourceEntries = Dictionary(uniqueKeysWithValues: syncSnapshot.sources.map { ($0.key, $0) })
        let currentSourceKeys = Set(sources.map(\.syncKey))

        for source in sources {
            let key = source.syncKey
            let current = CloudSyncSourceEntry(
                key: key,
                id: source.id,
                name: source.name,
                baseURL: source.normalizedBaseURL,
                isEnabled: source.isEnabled,
                updatedAt: now,
                deletedAt: nil
            )
            if let existing = sourceEntries[key],
               existing.name == current.name,
               existing.baseURL == current.baseURL,
               existing.isEnabled == current.isEnabled,
               existing.deletedAt == nil {
                continue
            }
            sourceEntries[key] = current
        }

        for key in sourceEntries.keys where !currentSourceKeys.contains(key) {
            guard var entry = sourceEntries[key], entry.deletedAt == nil else { continue }
            entry.deletedAt = now
            entry.updatedAt = now
            sourceEntries[key] = entry
        }

        var preferenceIDs = Set(syncSnapshot.preferences.map(\.id))
        preferenceIDs.formUnion(instanceAliases.keys)
        preferenceIDs.formUnion(countryOverrides.keys)
        preferenceIDs.formUnion(manualResetTimes.keys)
        preferenceIDs.formUnion(autoAdvanceResetTimeIDs)
        preferenceIDs.formUnion(resetDayAnchors.keys)

        var preferenceEntries = Dictionary(uniqueKeysWithValues: syncSnapshot.preferences.map { ($0.id, $0) })
        for id in preferenceIDs {
            let current = CloudSyncPreferenceEntry(
                id: id,
                alias: instanceAliases[id],
                countryOverride: countryOverrides[id],
                manualResetTime: manualResetTimes[id],
                resetDayAnchor: resetDayAnchors[id],
                autoAdvance: autoAdvanceResetTimeIDs.contains(id),
                updatedAt: now,
                countryOverrideCleared: clearedCountryOverrideIDs.contains(id) && countryOverrides[id] == nil
            )
            if let existing = preferenceEntries[id],
               existing.alias == current.alias,
               existing.countryOverride == current.countryOverride,
               existing.manualResetTime == current.manualResetTime,
               existing.resetDayAnchor == current.resetDayAnchor,
               existing.autoAdvance == current.autoAdvance {
                continue
            }
            preferenceEntries[id] = current
        }

        let orderUpdatedAt = order == syncSnapshot.order ? syncSnapshot.orderUpdatedAt : now
        syncSnapshot = CloudSyncSnapshot(
            version: CloudSyncSnapshot.currentVersion,
            sources: sourceEntries.values.sorted { $0.key < $1.key },
            preferences: preferenceEntries.values.sorted { $0.id < $1.id },
            order: order,
            orderUpdatedAt: orderUpdatedAt
        )
        persistSyncSnapshot()
        return syncSnapshot
    }

    private func applyCloudSyncSnapshot(_ snapshot: CloudSyncSnapshot) {
        isApplyingCloudSync = true
        defer { isApplyingCloudSync = false }

        let snapshot = CloudSyncMerger.migratedSnapshot(
            snapshot,
            using: Self.instanceIDMigrationMap(for: instances)
        )

        let existingByKey = Dictionary(uniqueKeysWithValues: sources.map { ($0.syncKey, $0) })
        let activeEntries = snapshot.sources.filter { !$0.isDeleted }
        sources = activeEntries.sorted { $0.key < $1.key }.map { entry in
            let existingID = existingByKey[entry.key]?.id ?? entry.id
            return MonitorSource(
                id: existingID,
                name: entry.name,
                baseURL: entry.baseURL,
                isEnabled: entry.isEnabled
            )
        }

        let sourceIDs = Set(sources.map(\.id))
        instances.removeAll { !sourceIDs.contains($0.source.id) }
        summaries = summaries.filter { sourceIDs.contains($0.key) }
        providers = providers.filter { sourceIDs.contains($0.key) }
        sourceErrors = sourceErrors.filter { sourceIDs.contains($0.key) }
        order = snapshot.order

        for entry in snapshot.preferences {
            instanceAliases[entry.id] = entry.alias
            if let countryOverride = entry.countryOverride {
                countryOverrides[entry.id] = countryOverride
                clearedCountryOverrideIDs.remove(entry.id)
            } else if entry.countryOverrideCleared {
                countryOverrides[entry.id] = nil
                clearedCountryOverrideIDs.insert(entry.id)
            }
            manualResetTimes[entry.id] = entry.manualResetTime
            resetDayAnchors[entry.id] = entry.resetDayAnchor
            if entry.autoAdvance {
                autoAdvanceResetTimeIDs.insert(entry.id)
            } else {
                autoAdvanceResetTimeIDs.remove(entry.id)
            }
        }

        syncSnapshot = snapshot
        persistSources()
        persistCache()
        persistPreferenceValues()
        persistSyncSnapshot()
        instances = Self.sorted(Self.unique(instances), using: order)
        migratePreferenceIDsToCurrentInstances()
    }

    private func persistPreferenceValues() {
        if let data = try? JSONEncoder.vpsMonitor.encode(instanceAliases) {
            defaults.set(data, forKey: aliasesKey)
        }
        if let data = try? JSONEncoder.vpsMonitor.encode(countryOverrides) {
            defaults.set(data, forKey: countryOverridesKey)
        }
        defaults.set(Array(clearedCountryOverrideIDs).sorted(), forKey: clearedCountryOverridesKey)
        if let data = try? JSONEncoder.vpsMonitor.encode(manualResetTimes) {
            defaults.set(data, forKey: manualResetTimesKey)
        }
        if let data = try? JSONEncoder.vpsMonitor.encode(resetDayAnchors) {
            defaults.set(data, forKey: resetDayAnchorsKey)
        }
        defaults.set(Array(autoAdvanceResetTimeIDs).sorted(), forKey: autoAdvanceResetTimesKey)
        defaults.set(order, forKey: orderKey)
    }

    private func persistSyncSnapshot() {
        if let data = try? Self.syncEncoder.encode(syncSnapshot) {
            defaults.set(data, forKey: syncSnapshotKey)
        }
    }

    private func persistSources() {
        if let data = try? JSONEncoder.vpsMonitor.encode(sources) {
            defaults.set(data, forKey: sourcesKey)
        }
        scheduleCloudSyncAfterLocalChange()
    }

    private func persistCache() {
        if let data = try? JSONEncoder.vpsMonitor.encode(instances) {
            defaults.set(data, forKey: instancesKey)
        }
    }

    private func migratePreferenceIDsToCurrentInstances() {
        let mapping = Self.instanceIDMigrationMap(for: instances)
        guard !mapping.isEmpty else { return }

        order = Self.migrateIDs(order, using: mapping)
        manualResetTimes = Self.migrateDictionary(manualResetTimes, using: mapping)
        instanceAliases = Self.migrateDictionary(instanceAliases, using: mapping)
        countryOverrides = Self.migrateDictionary(countryOverrides, using: mapping)
        clearedCountryOverrideIDs = Set(Self.migrateIDs(Array(clearedCountryOverrideIDs), using: mapping))
        resetDayAnchors = Self.migrateDictionary(resetDayAnchors, using: mapping)
        autoAdvanceResetTimeIDs = Set(Self.migrateIDs(Array(autoAdvanceResetTimeIDs), using: mapping))
        syncSnapshot = CloudSyncMerger.migratedSnapshot(syncSnapshot, using: mapping)
        persistPreferenceValues()
        persistSyncSnapshot()
    }

    private static func sorted(_ instances: [MonitoredInstance], using order: [String]) -> [MonitoredInstance] {
        let positions = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($1, $0) })
        return instances.sorted { lhs, rhs in
            let left = positions[lhs.id] ?? Int.max
            let right = positions[rhs.id] ?? Int.max
            if left != right { return left < right }
            let providerComparison = lhs.observation.provider.localizedStandardCompare(rhs.observation.provider)
            if providerComparison != .orderedSame { return providerComparison == .orderedAscending }
            return lhs.observation.displayName.localizedStandardCompare(rhs.observation.displayName) == .orderedAscending
        }
    }

    private static func unique(_ instances: [MonitoredInstance]) -> [MonitoredInstance] {
        var seen: Set<String> = []
        return instances.filter { seen.insert($0.id).inserted }
    }

    private static func preservingNewerAliyun(
        existing: [MonitoredInstance],
        incoming: [MonitoredInstance]
    ) -> [MonitoredInstance] {
        let existingByID = Dictionary(uniqueKeysWithValues: existing.map { ($0.id, $0) })
        return incoming.map { candidate in
            guard candidate.observation.provider == "aliyun_swas",
                  let current = existingByID[candidate.id],
                  let currentDate = VPSFormat.date(current.observation.observedAt),
                  let candidateDate = VPSFormat.date(candidate.observation.observedAt),
                  currentDate >= candidateDate else {
                return candidate
            }
            return current
        }
    }

    private static var syncEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    private static var syncDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private static func migrateIDs(_ ids: [String], using mapping: [String: String]) -> [String] {
        var seen: Set<String> = []
        return ids
            .map { mapping[$0] ?? $0 }
            .filter { seen.insert($0).inserted }
    }

    private static func migrateDictionary<Value>(
        _ values: [String: Value],
        using mapping: [String: String]
    ) -> [String: Value] {
        // Prefer an already-canonical value if both old and new IDs are
        // present. Dictionary iteration order is otherwise unspecified and
        // could make a migration randomly restore the wrong value.
        var result = values.filter { mapping[$0.key] == nil }
        for (key, value) in values where mapping[key] != nil {
            let migratedKey = mapping[key]!
            if result[migratedKey] == nil {
                result[migratedKey] = value
            }
        }
        return result
    }

    private static func instanceIDMigrationMap(
        for instances: [MonitoredInstance]
    ) -> [String: String] {
        var mapping: [String: String] = [:]
        for instance in instances {
            mapping[instance.legacyID] = instance.id
        }
        return mapping
    }
}

enum CloudSyncTrigger: Equatable {
    case launch
    case manual
    case daily
    case retry
    case localChange
    case networkRecovered
}

private enum FetchResult: Sendable {
    case success(SourceSnapshot)
    case failure(UUID, String)

    var failedSourceID: UUID? {
        guard case let .failure(sourceID, _) = self else { return nil }
        return sourceID
    }
}

private enum LiveFetchResult: Sendable {
    case success(MonitorSource, AliyunLiveResponse)
    case failure(String, String)
    case cancelled
}

private enum SourceError: LocalizedError {
    case duplicate

    var errorDescription: String? { "这个 API 地址已经导入" }
}
