import AppKit
import SwiftUI

/// A mote in SwiftUI. Drawn by a `MoteLayer`: once on screen it animates in
/// the render server, and costs the app nothing until the state changes or the
/// pointer moves.
struct MoteView: NSViewRepresentable {
    let personality: MotePersonality
    let state: MoteState
    /// Screen point (AppKit coordinates) the mote is drawn at, to follow the pointer;
    /// `nil` keeps the eyes looking ahead.
    let screenAnchor: CGPoint?

    func makeNSView(context: Context) -> MoteNSView {
        MoteNSView(personality: personality)
    }

    func updateNSView(_ view: MoteNSView, context: Context) {
        view.update(personality: personality, state: state, screenAnchor: screenAnchor)
    }

    static func dismantleNSView(_ view: MoteNSView, coordinator: ()) {
        view.stopTracking()
    }
}

/// Layer-hosting view for a `MoteLayer`.
final class MoteNSView: NSView {
    private let mote: MoteLayer
    private var screenAnchor: CGPoint?

    init(personality: MotePersonality) {
        mote = MoteLayer(personality: personality)
        super.init(frame: .zero)
        // Layer-hosting: set the layer before turning layers on.
        layer = mote
        wantsLayer = true
    }

    required init?(coder: NSCoder) {
        nil
    }

    func update(personality: MotePersonality, state: MoteState, screenAnchor: CGPoint?) {
        mote.configure(personality: personality)
        mote.apply(state)
        self.screenAnchor = screenAnchor
        followPointer()
    }

    /// Clicks go to whatever SwiftUI put around the mote (buttons, rows).
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        mote.contentsScale = window?.backingScaleFactor ?? 2
        if window == nil { stopTracking() } else { followPointer() }
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        mote.contentsScale = window?.backingScaleFactor ?? 2
    }

    func stopTracking() {
        PointerTracker.shared.stopObserving(self)
    }

    private func followPointer() {
        guard window != nil, screenAnchor != nil else {
            stopTracking()
            mote.pointerMoved(nil)
            return
        }
        PointerTracker.shared.observe(self) { [weak self] point in self?.pointerMoved(to: point) }
        if let point = PointerTracker.shared.location { pointerMoved(to: point) }
    }

    private func pointerMoved(to point: CGPoint) {
        guard let anchor = screenAnchor else { return }
        // AppKit y grows upwards; the mote uses y downwards.
        mote.pointerMoved(CGVector(dx: point.x - anchor.x, dy: anchor.y - point.y))
    }
}
