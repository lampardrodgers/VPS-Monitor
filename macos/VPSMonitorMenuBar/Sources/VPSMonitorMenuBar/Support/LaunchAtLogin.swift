import ServiceManagement

enum LaunchAtLogin {
    static var status: SMAppService.Status {
        SMAppService.mainApp.status
    }

    static var isEnabled: Bool {
        status == .enabled
    }

    static func setEnabled(_ enabled: Bool) throws {
        if enabled {
            try SMAppService.mainApp.register()
        } else if status != .notRegistered {
            try SMAppService.mainApp.unregister()
        }
    }

    static var statusMessage: String? {
        switch status {
        case .enabled:
            return nil
        case .notRegistered:
            return nil
        case .requiresApproval:
            return "已登记，请在系统设置 → 通用 → 登录项中允许 VPS Monitor"
        case .notFound:
            return "当前运行方式不支持开机启动，请从签名的 VPS Monitor.app 运行"
        @unknown default:
            return "无法读取开机启动状态"
        }
    }
}
