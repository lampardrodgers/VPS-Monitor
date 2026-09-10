import AppKit
import SwiftUI

/// Styles the enclosing native scroll view without replacing SwiftUI's scrolling or layout.
struct SubtleScrollAppearance: NSViewRepresentable {
    func makeNSView(context: Context) -> ScrollAppearanceView {
        ScrollAppearanceView()
    }

    func updateNSView(_ view: ScrollAppearanceView, context: Context) {
        view.scheduleConfiguration()
    }

    final class ScrollAppearanceView: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            scheduleConfiguration()
        }

        override func viewDidMoveToSuperview() {
            super.viewDidMoveToSuperview()
            scheduleConfiguration()
        }

        func scheduleConfiguration() {
            // SwiftUI attaches the content to its NSScrollView after creating this view.
            DispatchQueue.main.async { [weak self] in
                guard let scrollView = self?.enclosingScrollView else { return }
                if !(scrollView.verticalScroller is SubtleScroller) {
                    scrollView.verticalScroller = SubtleScroller()
                }
                scrollView.scrollerStyle = .overlay
                scrollView.autohidesScrollers = true
                scrollView.verticalScroller?.controlSize = .small
            }
        }
    }
}

/// Keeps AppKit's hit testing, dragging, hover expansion and automatic fading.
private final class SubtleScroller: NSScroller {
    override class var isCompatibleWithOverlayScrollers: Bool { true }

    override func drawKnob() {
        let mouse = window.map { convert($0.mouseLocationOutsideOfEventStream, from: nil) }
        let isHovered = mouse.map { bounds.contains($0) } ?? false
        let increaseContrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast

        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        NSGraphicsContext.current?.cgContext.setAlpha(increaseContrast ? 1 : (isHovered ? 0.85 : 0.45))
        super.drawKnob()
    }

    override func drawKnobSlot(in slotRect: NSRect, highlight flag: Bool) {
        // Leave the translucent panel visible instead of drawing a contrasting track.
    }
}
