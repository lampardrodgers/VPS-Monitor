import Foundation

struct SSHTunnelConfiguration: Sendable {
    let target: String
    let localPort: Int
    let remoteHost: String
    let remotePort: Int
    let identityFile: String?

    static let defaultLocalPort = 8_787

    static func load() -> SSHTunnelConfiguration? {
        let environment = ProcessInfo.processInfo.environment
        let configuredDirectory = environment["VPSMON_WEB_CONFIG_DIR"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let directory = configuredDirectory.flatMap { $0.isEmpty ? nil : $0 }
            .map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) }
            ?? FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".config/vpsmonitor/web", isDirectory: true)
        let fileURL = directory.appendingPathComponent(".env.local")
        guard let contents = try? String(contentsOf: fileURL, encoding: .utf8) else { return nil }
        let values = parse(contents)
        guard let target = values["VPSMON_SSH_TARGET"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !target.isEmpty else { return nil }

        let localPort = validPort(values["VPSMON_SSH_LOCAL_PORT"]) ?? defaultLocalPort
        let remotePort = validPort(values["VPSMON_SSH_REMOTE_PORT"]) ?? 18_787
        let remoteHost = values["VPSMON_SSH_REMOTE_HOST"]?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "127.0.0.1"
        let identity = values["VPSMON_SSH_IDENTITY_FILE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return SSHTunnelConfiguration(
            target: target,
            localPort: localPort,
            remoteHost: remoteHost.isEmpty ? "127.0.0.1" : remoteHost,
            remotePort: remotePort,
            identityFile: identity.flatMap { $0.isEmpty ? nil : ($0 as NSString).expandingTildeInPath }
        )
    }

    func applies(to source: MonitorSource) -> Bool {
        guard let url = URL(string: source.normalizedBaseURL),
              let host = url.host?.lowercased() else { return false }
        let isLoopback = host == "127.0.0.1" || host == "localhost" || host == "::1"
        let sourcePort = url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80)
        return isLoopback && sourcePort == localPort
    }

    var healthURL: URL? {
        URL(string: "http://127.0.0.1:\(localPort)/health")
    }

    private static func parse(_ contents: String) -> [String: String] {
        var result: [String: String] = [:]
        for rawLine in contents.split(whereSeparator: \.isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty, !line.hasPrefix("#"), let equals = line.firstIndex(of: "=") else { continue }
            let key = String(line[..<equals]).trimmingCharacters(in: .whitespacesAndNewlines)
            var value = String(line[line.index(after: equals)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if value.count >= 2,
               (value.hasPrefix("\"") && value.hasSuffix("\"") || value.hasPrefix("'") && value.hasSuffix("'")) {
                value.removeFirst()
                value.removeLast()
            }
            result[key] = value
        }
        return result
    }

    private static func validPort(_ raw: String?) -> Int? {
        guard let raw, let value = Int(raw), (1...65_535).contains(value) else { return nil }
        return value
    }
}
