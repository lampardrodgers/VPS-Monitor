import Foundation

enum SSHTunnelConfigurationError: LocalizedError {
    case missingTarget
    case invalidTarget
    case invalidRemotePort

    var errorDescription: String? {
        switch self {
        case .missingTarget:
            "请填写 SSH 地址，例如 root@203.0.113.10"
        case .invalidTarget:
            "SSH 地址不能包含空格、换行或命令参数"
        case .invalidRemotePort:
            "远端 API 端口必须在 1–65535 之间"
        }
    }
}

struct SSHTunnelConfiguration: Sendable {
    let target: String
    let localPort: Int
    let remoteHost: String
    let remotePort: Int
    let identityFile: String?

    static let defaultLocalPort = 8_787
    static let defaultRemotePort = 18_787

    static func load() -> SSHTunnelConfiguration? {
        for fileURL in configurationFileURLs() {
            guard let contents = try? String(contentsOf: fileURL, encoding: .utf8),
                  let configuration = parseConfiguration(contents) else { continue }
            return configuration
        }
        return nil
    }

    static var storagePath: String {
        configurationFileURLs()[0].path
    }

    static func save(target: String, remotePort: Int, identityFile: String?) throws {
        let normalizedTarget = target.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedTarget.isEmpty else { throw SSHTunnelConfigurationError.missingTarget }
        guard !normalizedTarget.hasPrefix("-"),
              normalizedTarget.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
            throw SSHTunnelConfigurationError.invalidTarget
        }
        guard (1...65_535).contains(remotePort) else {
            throw SSHTunnelConfigurationError.invalidRemotePort
        }

        let fileURL = configurationFileURLs()[0]
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        var lines = [
            "VPSMON_SSH_TARGET=\(normalizedTarget)",
            "VPSMON_SSH_LOCAL_PORT=\(defaultLocalPort)",
            "VPSMON_SSH_REMOTE_HOST=127.0.0.1",
            "VPSMON_SSH_REMOTE_PORT=\(remotePort)"
        ]
        if let identityFile {
            let normalizedIdentity = identityFile.trimmingCharacters(in: .whitespacesAndNewlines)
            if !normalizedIdentity.isEmpty {
                lines.append("VPSMON_SSH_IDENTITY_FILE=\(normalizedIdentity)")
            }
        }
        try (lines.joined(separator: "\n") + "\n").write(
            to: fileURL,
            atomically: true,
            encoding: .utf8
        )
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    private static func parseConfiguration(_ contents: String) -> SSHTunnelConfiguration? {
        let values = parse(contents)
        guard let target = values["VPSMON_SSH_TARGET"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !target.isEmpty else { return nil }

        let localPort = validPort(values["VPSMON_SSH_LOCAL_PORT"]) ?? defaultLocalPort
        let remotePort = validPort(values["VPSMON_SSH_REMOTE_PORT"]) ?? defaultRemotePort
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

    private static func configurationFileURLs() -> [URL] {
        let environment = ProcessInfo.processInfo.environment
        if let configured = environment["VPSMON_MACOS_CONFIG_DIR"]?
            .trimmingCharacters(in: .whitespacesAndNewlines), !configured.isEmpty {
            let directory = URL(fileURLWithPath: (configured as NSString).expandingTildeInPath)
            return [directory.appendingPathComponent("connection.env")]
        }
        if let configured = environment["VPSMON_WEB_CONFIG_DIR"]?
            .trimmingCharacters(in: .whitespacesAndNewlines), !configured.isEmpty {
            let directory = URL(fileURLWithPath: (configured as NSString).expandingTildeInPath)
            return [directory.appendingPathComponent(".env.local")]
        }

        let base = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/vpsmonitor", isDirectory: true)
        return [
            base.appendingPathComponent("macos/connection.env"),
            base.appendingPathComponent("web/.env.local")
        ]
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
