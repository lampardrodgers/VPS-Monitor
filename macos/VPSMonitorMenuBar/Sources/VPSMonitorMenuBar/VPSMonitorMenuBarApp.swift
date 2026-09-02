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
            NSApp.activate(ignoringOtherApps: true)
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
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
        menuBarPanelController?.toggle(anchorPoint: NSEvent.mouseLocation)
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
