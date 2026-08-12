import AppKit
import SwiftUI

/// A real AppKit visual-effect backdrop for the transparent menu bar panel.
struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .underWindowBackground
    var blendingMode: NSVisualEffectView.BlendingMode = .behindWindow

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        configure(view)
        DispatchQueue.main.async { Self.makeWindowTransparent(view.window) }
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        configure(view)
        DispatchQueue.main.async { Self.makeWindowTransparent(view.window) }
    }

    private func configure(_ view: NSVisualEffectView) {
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        view.isEmphasized = true
    }

    private static func makeWindowTransparent(_ window: NSWindow?) {
        window?.isOpaque = false
        window?.backgroundColor = .clear
    }
}
