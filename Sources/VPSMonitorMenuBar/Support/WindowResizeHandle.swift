@preconcurrency import AppKit
import SwiftUI

struct WindowResizeHandle: NSViewRepresentable {
    enum Side {
        case left
        case right
    }

    let side: Side

    func makeNSView(context: Context) -> CornerResizeView {
        CornerResizeView(side: side)
    }

    func updateNSView(_ view: CornerResizeView, context: Context) {}
}

final class CornerResizeView: NSView {
    private let side: WindowResizeHandle.Side
    private let symbolImage: NSImage
    private var initialWindowFrame = NSRect.zero
    private var initialMouseLocation = NSPoint.zero

    init(side: WindowResizeHandle.Side) {
        self.side = side
        self.symbolImage = NSImage(
            systemSymbolName: side == .left
                ? "arrow.up.right.and.arrow.down.left"
                : "arrow.up.left.and.arrow.down.right",
            accessibilityDescription: "拖动调整窗口大小"
        ) ?? NSImage()
        super.init(frame: NSRect(x: 0, y: 0, width: 22, height: 22))
        toolTip = "拖动调整窗口大小"
        setAccessibilityRole(.handle)
        setAccessibilityLabel("拖动调整窗口大小")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var intrinsicContentSize: NSSize { NSSize(width: 22, height: 22) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let imageRect = NSRect(
            x: (bounds.width - 16) / 2,
            y: (bounds.height - 16) / 2,
            width: 16,
            height: 16
        )
        symbolImage.draw(in: imageRect)
    }

    override func resetCursorRects() {
        super.resetCursorRects()
        addCursorRect(
            bounds,
            cursor: NSCursor(
                image: symbolImage,
                hotSpot: NSPoint(x: 8, y: 8)
            )
        )
    }

    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        initialWindowFrame = window.frame
        initialMouseLocation = window.convertPoint(toScreen: event.locationInWindow)
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window else { return }
        let mouseLocation = window.convertPoint(toScreen: event.locationInWindow)
        let deltaX = mouseLocation.x - initialMouseLocation.x
        let deltaY = mouseLocation.y - initialMouseLocation.y
        let minimum = MenuBarPanelSize.minimumSize
        var frame = initialWindowFrame

        if side == .left {
            frame.size.width = max(minimum.width, initialWindowFrame.width - deltaX)
            frame.origin.x = initialWindowFrame.maxX - frame.width
        } else {
            frame.size.width = max(minimum.width, initialWindowFrame.width + deltaX)
        }

        frame.size.height = max(minimum.height, initialWindowFrame.height - deltaY)
        frame.origin.y = initialWindowFrame.maxY - frame.height
        window.setFrame(frame, display: true)
    }
}
