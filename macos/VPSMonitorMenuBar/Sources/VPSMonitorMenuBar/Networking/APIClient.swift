import Foundation

enum APIError: LocalizedError, Sendable {
    case invalidBaseURL
    case invalidResponse
    case http(status: Int, detail: String?)
    case decoding
    case network(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            "API 地址无效"
        case .invalidResponse:
            "API 返回了无效响应"
        case let .http(status, detail):
            detail ?? "API 请求失败（HTTP \(status)）"
        case .decoding:
            "API 返回的数据格式无法解析"
        case let .network(message):
            message
        }
    }
}

struct APIClient: Sendable {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: String, session: URLSession = .shared) throws {
        let value = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: value), let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme), url.host != nil else {
            throw APIError.invalidBaseURL
        }
        self.baseURL = url
        self.session = session
    }

    func fetchHealth() async throws -> HealthResponse {
        try await request(path: "/health")
    }

    func fetchSummary() async throws -> SummaryResponse {
        try await request(path: "/api/v1/summary")
    }

    func fetchProviders() async throws -> ProviderListResponse {
        try await request(path: "/api/v1/providers")
    }

    func fetchRetentionSettings() async throws -> RetentionSettings {
        try await request(path: "/api/v1/settings/retention")
    }

    func updateRetentionSettings(_ value: RetentionSettingsUpdate) async throws -> RetentionSettings {
        let body = try JSONEncoder.vpsMonitor.encode(value)
        return try await request(
            path: "/api/v1/settings/retention",
            method: "PUT",
            body: body
        )
    }

    func fetchAllInstances() async throws -> InstanceListResponse {
        let pageSize = 500
        let maximum = 2_000
        var offset = 0
        var items: [InstanceObservation] = []
        var reportedTotal = 0

        repeat {
            let page: InstanceListResponse = try await request(
                path: "/api/v1/instances",
                query: [
                    URLQueryItem(name: "offset", value: String(offset)),
                    URLQueryItem(name: "limit", value: String(pageSize))
                ]
            )
            reportedTotal = page.total
            items.append(contentsOf: page.items)
            offset += page.items.count
            if page.items.isEmpty { break }
        } while items.count < min(reportedTotal, maximum)

        return InstanceListResponse(total: reportedTotal, offset: 0, limit: items.count, items: items)
    }

    func fetchAliyunLive() async throws -> AliyunLiveResponse {
        try await request(
            path: "/api/v1/live/aliyun_swas",
            timeout: 60,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
    }

    func fetchHistory(provider: String, instanceKey: String, hours: Int) async throws -> InstanceHistoryResponse {
        let limit = hours > 168 ? 10_000 : 1_000
        return try await request(
            path: "/api/v1/instances/\(encodePath(provider))/\(encodePath(instanceKey))/history",
            query: [
                URLQueryItem(name: "hours", value: String(hours)),
                URLQueryItem(name: "limit", value: String(limit))
            ]
        )
    }

    func fetchSnapshot(source: MonitorSource) async throws -> SourceSnapshot {
        async let health = fetchHealth()
        async let summary = fetchSummary()
        async let providers = fetchProviders()
        async let observations = fetchAllInstances()

        let values = try await (health, summary, providers, observations)
        return SourceSnapshot(
            source: source,
            health: values.0,
            summary: values.1,
            providers: values.2.items,
            instances: values.3.items.map { MonitoredInstance(source: source, observation: $0) }
        )
    }

    private func request<Response: Decodable & Sendable>(
        path: String,
        query: [URLQueryItem] = [],
        method: String = "GET",
        body: Data? = nil,
        timeout: TimeInterval = 15,
        cachePolicy: URLRequest.CachePolicy = .useProtocolCachePolicy
    ) async throws -> Response {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidBaseURL
        }
        let basePath = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = basePath + path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw APIError.invalidBaseURL }

        var request = URLRequest(url: url, cachePolicy: cachePolicy, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if cachePolicy == .reloadIgnoringLocalCacheData {
            request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            if Task.isCancelled { throw CancellationError() }
            throw APIError.network("无法连接到本地监控 API：\(error.localizedDescription)")
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let detail = (try? JSONDecoder.vpsMonitor.decode(ErrorDetail.self, from: data))?.detail
            throw APIError.http(status: http.statusCode, detail: detail)
        }
        do {
            return try JSONDecoder.vpsMonitor.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    private func encodePath(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }
}

private struct ErrorDetail: Decodable {
    let detail: String?
}
