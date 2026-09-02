@preconcurrency import AppKit
import SwiftUI

enum MenuBarPanelSize {
    static let minimumSize = NSSize(width: 400, height: 480)
    static let defaultSize = NSSize(width: 430, height: 610)
    static let defaultsKey = "monitor.menuBarPanelContentSize.v2"

    static func constrained(_ size: NSSize, to visibleFrame: NSRect? = nil) -> NSSize {
        var result = NSSize(
            width: max(minimumSize.width, size.width),
            height: max(minimumSize.height, size.height)
        )
        if let visibleFrame {
            result.width = min(result.width, max(minimumSize.width, visibleFrame.width - 16))
            result.height = min(result.height, max(minimumSize.height, visibleFrame.height - 16))
        }
        return result
    }

    static func restoredSize(defaults: UserDefaults = .standard) -> NSSize {
        guard let value = defaults.string(forKey: defaultsKey) else {
            return defaultSize
        }
        return constrained(NSSizeFromString(value))
    }
}

@MainActor
final class MenuBarPanelController: NSObject, NSWindowDelegate {
    private let panel: MenuBarPanel
    // Ignore SwiftUI's initial fitting pass; it is not a user resize and must
    // not overwrite the remembered/default panel size.
    private var isRestoringSize = true

    var isVisible: Bool { panel.isVisible }

    init(store: MonitorStore) {
        let hostingController = NSHostingController(rootView: MenuContentView(store: store))
        let panel = MenuBarPanel(
            contentRect: NSRect(origin: .zero, size: MenuBarPanelSize.defaultSize),
            styleMask: [.borderless, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        let containerController = NSViewController()
        let containerView = NSView(frame: NSRect(origin: .zero, size: MenuBarPanelSize.defaultSize))
        containerController.view = containerView
        containerController.addChild(hostingController)
        hostingController.view.frame = containerView.bounds
        hostingController.view.autoresizingMask = [.width, .height]
        containerView.addSubview(hostingController.view)

        panel.contentViewController = containerController
        panel.contentMinSize = MenuBarPanelSize.minimumSize
        panel.minSize = MenuBarPanelSize.minimumSize
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .statusBar
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .utilityWindow
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.titlebarSeparatorStyle = .none
        panel.showsResizeIndicator = true
        panel.acceptsMouseMovedEvents = true

        self.panel = panel
        super.init()
        panel.delegate = self
        panel.standardWindowButton(.closeButton)?.isHidden = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true

        containerView.wantsLayer = true
        containerView.layer?.cornerRadius = 16
        containerView.layer?.cornerCurve = .continuous
        containerView.layer?.masksToBounds = true
    }

    func toggle(anchorPoint: NSPoint) {
        if panel.isVisible {
            hide()
        } else {
            show(anchorPoint: anchorPoint)
        }
    }

    func hide() {
        panel.orderOut(nil)
    }

    func show() {
        let screen = NSScreen.main ?? NSScreen.screens.first
        let anchorPoint = NSPoint(
            x: (screen?.visibleFrame.minX ?? 0) + 30,
            y: (screen?.frame.maxY ?? 0) - 15
        )
        show(anchorPoint: anchorPoint)
    }

    private func show(anchorPoint: NSPoint) {
        let screen = NSScreen.screens.first(where: { $0.frame.contains(anchorPoint) })
            ?? NSScreen.main
            ?? NSScreen.screens.first
        let visibleFrame = screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        let restoredSize = MenuBarPanelSize.constrained(MenuBarPanelSize.restoredSize(), to: visibleFrame)
        let menuBarAnchor = NSRect(
            x: anchorPoint.x - 19,
            y: (screen?.frame.maxY ?? anchorPoint.y) - 30,
            width: 38,
            height: 30
        )

        isRestoringSize = true
        panel.setContentSize(restoredSize)
        positionPanel(below: menuBarAnchor, in: visibleFrame)
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.async { [weak self] in
            self?.isRestoringSize = false
        }
    }

    private func positionPanel(below buttonFrame: NSRect, in visibleFrame: NSRect) {
        let panelSize = panel.frame.size
        let preferredX = buttonFrame.midX - panelSize.width / 2
        let x = min(
            max(preferredX, visibleFrame.minX + 8),
            visibleFrame.maxX - panelSize.width - 8
        )
        let preferredY = buttonFrame.minY - panelSize.height
        let y = min(
            max(preferredY, visibleFrame.minY + 8),
            visibleFrame.maxY - panelSize.height
        )
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }

    func windowDidResize(_ notification: Notification) {
        guard !isRestoringSize else { return }
        let size = MenuBarPanelSize.constrained(panel.contentLayoutRect.size)
        UserDefaults.standard.set(NSStringFromSize(size), forKey: MenuBarPanelSize.defaultsKey)
    }

    func windowWillResize(_ sender: NSWindow, to frameSize: NSSize) -> NSSize {
        MenuBarPanelSize.constrained(frameSize)
    }
}

final class MenuBarPanel: NSPanel {
    private struct ResizeEdges: OptionSet {
        let rawValue: Int

        static let left = ResizeEdges(rawValue: 1 << 0)
        static let right = ResizeEdges(rawValue: 1 << 1)
        static let bottom = ResizeEdges(rawValue: 1 << 2)
        static let top = ResizeEdges(rawValue: 1 << 3)
    }

    private static let edgeHitWidth: CGFloat = 11
    private static let bottomCornerHitWidth: CGFloat = 28
    private static let topCornerHitWidth: CGFloat = 16
    private static let northwestSoutheastCursor = diagonalCursor(
        symbol: "arrow.up.left.and.arrow.down.right"
    )
    private static let northeastSouthwestCursor = diagonalCursor(
        symbol: "arrow.up.right.and.arrow.down.left"
    )

    private var activeResizeEdges: ResizeEdges = []
    private var initialResizeFrame = NSRect.zero
    private var initialResizeMouseLocation = NSPoint.zero

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) {
        orderOut(sender)
    }

    override func sendEvent(_ event: NSEvent) {
        if handleResizeEvent(event) { return }
        super.sendEvent(event)
    }

    func handleResizeEvent(_ event: NSEvent) -> Bool {
        switch event.type {
        case .leftMouseDown:
            activeResizeEdges = resizeEdges(at: event.locationInWindow)
            if !activeResizeEdges.isEmpty {
                initialResizeFrame = frame
                initialResizeMouseLocation = convertPoint(toScreen: event.locationInWindow)
                return true
            }
        case .leftMouseDragged:
            if !activeResizeEdges.isEmpty {
                resize(with: event)
                return true
            }
        case .leftMouseUp:
            if !activeResizeEdges.isEmpty {
                activeResizeEdges = []
                return true
            }
        case .mouseMoved:
            updateResizeCursor(at: event.locationInWindow)
        default:
            break
        }
        return false
    }

    private func resize(with event: NSEvent) {
        let currentMouseLocation = convertPoint(toScreen: event.locationInWindow)
        let deltaX = currentMouseLocation.x - initialResizeMouseLocation.x
        let deltaY = currentMouseLocation.y - initialResizeMouseLocation.y
        let minimum = MenuBarPanelSize.minimumSize
        var newFrame = initialResizeFrame

        if activeResizeEdges.contains(.left) {
            newFrame.size.width = max(minimum.width, initialResizeFrame.width - deltaX)
            newFrame.origin.x = initialResizeFrame.maxX - newFrame.width
        } else if activeResizeEdges.contains(.right) {
            newFrame.size.width = max(minimum.width, initialResizeFrame.width + deltaX)
        }

        if activeResizeEdges.contains(.bottom) {
            newFrame.size.height = max(minimum.height, initialResizeFrame.height - deltaY)
            newFrame.origin.y = initialResizeFrame.maxY - newFrame.height
        } else if activeResizeEdges.contains(.top) {
            newFrame.size.height = max(minimum.height, initialResizeFrame.height + deltaY)
        }

        setFrame(newFrame, display: true)
    }

    private func updateResizeCursor(at point: NSPoint) {
        let edges = resizeEdges(at: point)
        switch edges {
        case [.left, .bottom], [.right, .top]:
            Self.northwestSoutheastCursor.set()
        case [.right, .bottom], [.left, .top]:
            Self.northeastSouthwestCursor.set()
        default:
            if edges.contains(.left) || edges.contains(.right) {
                NSCursor.resizeLeftRight.set()
            } else if edges.contains(.top) || edges.contains(.bottom) {
                NSCursor.resizeUpDown.set()
            } else {
                NSCursor.arrow.set()
            }
        }
    }

    private func resizeEdges(at point: NSPoint) -> ResizeEdges {
        let contentBounds = NSRect(origin: .zero, size: contentLayoutRect.size)
        guard contentBounds.contains(point) else { return [] }
        let bottomCorner = Self.bottomCornerHitWidth
        let topCorner = Self.topCornerHitWidth

        if point.x <= bottomCorner, point.y <= bottomCorner { return [.left, .bottom] }
        if point.x >= contentBounds.width - bottomCorner, point.y <= bottomCorner { return [.right, .bottom] }
        if point.x <= topCorner, point.y >= contentBounds.height - topCorner { return [.left, .top] }
        if point.x >= contentBounds.width - topCorner, point.y >= contentBounds.height - topCorner { return [.right, .top] }

        var result: ResizeEdges = []
        let edge = Self.edgeHitWidth
        if point.x <= edge { result.insert(.left) }
        if point.x >= contentBounds.width - edge { result.insert(.right) }
        if point.y <= edge { result.insert(.bottom) }
        if point.y >= contentBounds.height - edge { result.insert(.top) }
        return result
    }

    private static func diagonalCursor(symbol: String) -> NSCursor {
        guard let image = NSImage(
            systemSymbolName: symbol,
            accessibilityDescription: "调整窗口大小"
        ) else {
            return .crosshair
        }
        image.size = NSSize(width: 18, height: 18)
        return NSCursor(image: image, hotSpot: NSPoint(x: 9, y: 9))
    }
}
