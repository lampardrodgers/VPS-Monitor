import AppKit
import SwiftUI

@main
struct VPSMonitorMenuBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            SettingsView(store: appDelegate.store)
        }

    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let store = MonitorStore()

    private var statusItem: NSStatusItem?
    private var menuBarPanelController: MenuBarPanelController?
    private var previewWindow: NSWindow?
    private var isPanelTestRun = false
    private var openSettingsAction: (() -> Void)?
    private var customIntervalWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let showsPreview = ProcessInfo.processInfo.arguments.contains("--preview-window")
        NSApp.setActivationPolicy(showsPreview ? .regular : .accessory)
        store.startLiveRefreshLoop()
        store.startCloudSyncLoop()

        if showsPreview {
            showPreviewWindow()
        } else {
            installMenuBarItem()
            showFirstRunSettingsIfNeeded()
        }
    }

    private func showFirstRunSettingsIfNeeded() {
        guard SSHTunnelConfiguration.load() == nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            self.openSettingsAction?()
        }
    }

    private func installMenuBarItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = item.button else { return }
        button.image = NSImage(systemSymbolName: "server.rack", accessibilityDescription: "VPS Monitor")
        button.image?.isTemplate = true
        button.toolTip = "VPS Monitor"
        button.target = self
        button.action = #selector(toggleMenuBarPanel(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        let settingsBridge = SettingsActionHostingView(rootView: SettingsActionBridge { [weak self] action in
            self?.openSettingsAction = action
        })
        settingsBridge.frame = NSRect(x: 0, y: 0, width: 1, height: 1)
        button.addSubview(settingsBridge)

        isPanelTestRun = ProcessInfo.processInfo.arguments.contains("--show-menu-panel")
        statusItem = item
        menuBarPanelController = MenuBarPanelController(store: store)

        if isPanelTestRun {
            DispatchQueue.main.async { [weak self] in
                self?.menuBarPanelController?.show()
            }
        }
    }

    @objc private func toggleMenuBarPanel(_ sender: NSStatusBarButton) {
        if let event = NSApp.currentEvent,
           event.type == .rightMouseUp || event.modifierFlags.contains(.control) {
            menuBarPanelController?.hide()
            let menu = makeContextMenu()
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.minY), in: sender)
            return
        }
        menuBarPanelController?.toggle(anchorPoint: NSEvent.mouseLocation)
    }

    private func makeContextMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.addItem(contextItem("设置…", action: #selector(openSettingsFromMenu), symbol: "gearshape"))

        let loginItem = contextItem("开机自动启动", action: #selector(toggleLaunchAtLogin), symbol: "power")
        loginItem.state = LaunchAtLogin.isEnabled ? .on : (LaunchAtLogin.status == .requiresApproval ? .mixed : .off)
        loginItem.toolTip = LaunchAtLogin.statusMessage
        menu.addItem(loginItem)
        menu.addItem(.separator())

        let intervalItem = NSMenuItem(title: "刷新间隔（\(store.liveRefreshSchedule.compactTitle)）", action: nil, keyEquivalent: "")
        intervalItem.image = NSImage(systemSymbolName: "timer", accessibilityDescription: nil)
        let intervals = NSMenu()
        intervals.autoenablesItems = false
        let caption = NSMenuItem(title: "阿里云实时刷新", action: nil, keyEquivalent: "")
        caption.isEnabled = false
        intervals.addItem(caption)
        for schedule in LiveRefreshSchedule.presets {
            let item = contextItem(schedule.title, action: #selector(selectRefreshInterval(_:)))
            item.representedObject = schedule
            item.state = store.liveRefreshSchedule == schedule ? .on : .off
            intervals.addItem(item)
        }
        if store.liveRefreshSchedule.presetSeconds == nil {
            let current = NSMenuItem(title: "自定义：\(store.liveRefreshSchedule.title)", action: nil, keyEquivalent: "")
            current.state = .on
            current.isEnabled = false
            intervals.addItem(current)
        }
        intervals.addItem(.separator())
        intervals.addItem(contextItem("自定义…", action: #selector(openCustomIntervalFromMenu)))
        intervalItem.submenu = intervals
        menu.addItem(intervalItem)

        let refreshing = store.isRefreshing || store.isRefreshingAliyun
        let refreshItem = contextItem(refreshing ? "正在刷新…" : "立即刷新", action: #selector(refreshFromMenu), symbol: "arrow.clockwise")
        refreshItem.isEnabled = !refreshing
        menu.addItem(refreshItem)
        menu.addItem(.separator())
        menu.addItem(contextItem("退出 VPS Monitor", action: #selector(quitFromMenu), symbol: "rectangle.portrait.and.arrow.right"))
        return menu
    }

    private func contextItem(_ title: String, action: Selector, symbol: String? = nil) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        if let symbol {
            item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        }
        return item
    }

    @objc private func openSettingsFromMenu() {
        openSettingsAction?()
    }

    @objc private func openCustomIntervalFromMenu() {
        if let window = customIntervalWindow, window.isVisible {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            return
        }
        let content = CustomIntervalView(current: store.liveRefreshSchedule, onDismiss: { [weak self] in
            self?.customIntervalWindow?.close()
        }) { [weak self] schedule in
            self?.store.setLiveRefreshSchedule(schedule)
        }
        let window = NSWindow(contentViewController: NSHostingController(rootView: content))
        window.title = "自定义刷新间隔"
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.center()
        customIntervalWindow = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    @objc private func toggleLaunchAtLogin() {
        do {
            let isRegistered = LaunchAtLogin.isEnabled || LaunchAtLogin.status == .requiresApproval
            try LaunchAtLogin.setEnabled(!isRegistered)
            if let message = LaunchAtLogin.statusMessage {
                showLoginItemMessage(message)
            }
        } catch {
            showLoginItemMessage("无法更新登录项：\(error.localizedDescription)")
        }
    }

    private func showLoginItemMessage(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "开机自动启动"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
    }

    @objc private func selectRefreshInterval(_ sender: NSMenuItem) {
        guard let schedule = sender.representedObject as? LiveRefreshSchedule else { return }
        store.setLiveRefreshSchedule(schedule)
    }

    @objc private func refreshFromMenu() {
        guard !store.isRefreshing, !store.isRefreshingAliyun else { return }
        Task { await store.refreshAll() }
    }

    @objc private func quitFromMenu() {
        NSApp.terminate(nil)
    }

    func applicationDidResignActive(_ notification: Notification) {
        guard !isPanelTestRun,
              menuBarPanelController?.isVisible == true else { return }
        menuBarPanelController?.hide()
    }

    private func showPreviewWindow() {
        let controller = NSHostingController(rootView: MenuContentView(store: store))
        let window = NSWindow(contentViewController: controller)
        window.title = "VPS Monitor Preview"
        window.setContentSize(MenuBarPanelSize.restoredSize())
        window.styleMask = [.titled, .closable, .resizable, .fullSizeContentView]
        window.contentMinSize = MenuBarPanelSize.minimumSize
        window.titlebarAppearsTransparent = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        previewWindow = window
    }
}

/// Gives the AppKit status menu access to SwiftUI's supported Settings scene action.
private struct SettingsActionBridge: View {
    @Environment(\.openSettings) private var openSettings
    let register: (@escaping () -> Void) -> Void

    var body: some View {
        Color.clear
            .onAppear {
                register {
                    NSApp.activate(ignoringOtherApps: true)
                    openSettings()
                }
            }
    }
}

private final class SettingsActionHostingView: NSHostingView<SettingsActionBridge> {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
