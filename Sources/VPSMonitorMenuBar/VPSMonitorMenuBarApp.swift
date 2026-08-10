import AppKit
import SwiftUI

@main
struct VPSMonitorMenuBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var store = MonitorStore()

    var body: some Scene {
        MenuBarExtra {
            MenuContentView(store: store)
        } label: {
            Label("VPS Monitor", systemImage: menuBarSymbol)
                .onAppear {
                    store.startLiveRefreshLoop()
                }
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView(store: store)
        }
    }

    private var menuBarSymbol: String {
        if !store.sourceErrors.isEmpty { return "server.rack" }
        return store.onlineCount == store.totalCount && store.totalCount > 0
            ? "server.rack"
            : "server.rack"
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var previewWindow: NSWindow?
    private var previewStore: MonitorStore?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let showsPreview = ProcessInfo.processInfo.arguments.contains("--preview-window")
        NSApp.setActivationPolicy(showsPreview ? .regular : .accessory)
        guard showsPreview else { return }

        let store = MonitorStore()
        let controller = NSHostingController(rootView: MenuContentView(store: store))
        let window = NSWindow(contentViewController: controller)
        window.title = "VPS Monitor Preview"
        window.setContentSize(NSSize(width: 430, height: 650))
        window.styleMask = [.titled, .closable, .fullSizeContentView]
        window.titlebarAppearsTransparent = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        previewStore = store
        previewWindow = window
    }
}
