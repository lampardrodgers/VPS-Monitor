import Foundation

enum SSHTunnelError: LocalizedError {
    case missingConfiguration
    case launchFailed(String)
    case exited(Int32)
    case connectionTimeout

    var errorDescription: String? {
        switch self {
        case .missingConfiguration:
            "尚未配置 VPS SSH 连接，请在应用设置中填写"
        case let .launchFailed(message):
            "无法启动 SSH：\(message)"
        case let .exited(status):
            "SSH 在建立临时连接时退出（状态码 \(status)）"
        case .connectionTimeout:
            "SSH 连接超时，远端没有及时建立 API 转发"
        }
    }
}

/// Owns an SSH process only while one or more API refresh operations are active.
/// Concurrent refreshes share the same short-lived process via a lease count.
@MainActor
final class EphemeralSSHTunnel {
    private var process: Process?
    private var leaseCount = 0
    private var pendingStopTask: Task<Void, Never>?

    deinit {
        pendingStopTask?.cancel()
        if process?.isRunning == true {
            process?.terminate()
        }
    }

    func requiresTunnel(for source: MonitorSource) -> Bool {
        let port = SSHTunnelConfiguration.load()?.localPort ?? SSHTunnelConfiguration.defaultLocalPort
        guard let url = URL(string: source.normalizedBaseURL),
              let host = url.host?.lowercased() else { return false }
        let sourcePort = url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80)
        return ["127.0.0.1", "localhost", "::1"].contains(host) && sourcePort == port
    }

    func acquireIfNeeded(for sources: [MonitorSource]) async throws -> Bool {
        guard sources.contains(where: requiresTunnel(for:)) else { return false }
        guard let configuration = SSHTunnelConfiguration.load() else {
            throw SSHTunnelError.missingConfiguration
        }

        pendingStopTask?.cancel()
        pendingStopTask = nil
        leaseCount += 1
        do {
            try await ensureReady(configuration)
            return true
        } catch {
            leaseCount = max(0, leaseCount - 1)
            if leaseCount == 0 { stopOwnedProcess() }
            throw error
        }
    }

    func release(_ acquired: Bool) {
        guard acquired else { return }
        leaseCount = max(0, leaseCount - 1)
        guard leaseCount == 0 else { return }

        // refreshAll() 会紧接着执行普通与实时请求。留一个极短的交接窗口，
        // 可以复用同一个 SSH 进程，避免刚释放端口就立即重新绑定。
        pendingStopTask?.cancel()
        pendingStopTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            self?.stopIfUnused()
        }
    }

    private func ensureReady(_ configuration: SSHTunnelConfiguration) async throws {
        if await endpointIsReady(configuration) { return }

        if process?.isRunning != true {
            let ssh = Process()
            ssh.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
            ssh.arguments = arguments(for: configuration)
            ssh.standardInput = FileHandle.nullDevice
            ssh.standardOutput = FileHandle.nullDevice
            ssh.standardError = FileHandle.nullDevice
            do {
                try ssh.run()
            } catch {
                throw SSHTunnelError.launchFailed(error.localizedDescription)
            }
            process = ssh
        }

        for _ in 0..<80 {
            if await endpointIsReady(configuration) { return }
            if let process, !process.isRunning {
                let status = process.terminationStatus
                self.process = nil
                throw SSHTunnelError.exited(status)
            }
            try Task.checkCancellation()
            try await Task.sleep(for: .milliseconds(150))
        }

        stopOwnedProcess()
        throw SSHTunnelError.connectionTimeout
    }

    private func endpointIsReady(_ configuration: SSHTunnelConfiguration) async -> Bool {
        guard let url = configuration.healthURL else { return false }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 0.8)
        request.httpMethod = "GET"
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return response is HTTPURLResponse
        } catch {
            return false
        }
    }

    private func arguments(for configuration: SSHTunnelConfiguration) -> [String] {
        var values = [
            "-N", "-T",
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=10",
            "-o", "ConnectionAttempts=1",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=2",
            "-o", "ControlMaster=no",
            "-L", "127.0.0.1:\(configuration.localPort):\(configuration.remoteHost):\(configuration.remotePort)"
        ]
        if let identityFile = configuration.identityFile {
            values.append(contentsOf: ["-i", identityFile])
        }
        values.append(configuration.target)
        return values
    }

    private func stopOwnedProcess() {
        guard let process else { return }
        if process.isRunning { process.terminate() }
        self.process = nil
    }

    private func stopIfUnused() {
        guard leaseCount == 0 else { return }
        pendingStopTask = nil
        stopOwnedProcess()
    }
}
