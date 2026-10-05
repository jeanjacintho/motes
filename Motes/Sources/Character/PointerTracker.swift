import CoreGraphics

/// Shares the pointer position with visible motes, so their eyes follow it.
/// Fed by the island's mouse monitors: it only does work when the mouse moves.
@MainActor
final class PointerTracker {
    static let shared = PointerTracker()

    /// Last known pointer position, in AppKit screen coordinates.
    private(set) var location: CGPoint?
    private var observers: [ObjectIdentifier: (CGPoint) -> Void] = [:]

    func update(_ point: CGPoint) {
        location = point
        for observer in observers.values { observer(point) }
    }

    func observe(_ owner: AnyObject, _ handler: @escaping (CGPoint) -> Void) {
        observers[ObjectIdentifier(owner)] = handler
    }

    func stopObserving(_ owner: AnyObject) {
        observers[ObjectIdentifier(owner)] = nil
    }
}
