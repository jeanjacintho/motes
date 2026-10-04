import CoreGraphics

enum IslandMode: Equatable, Sendable {
    /// Nothing to show: the island is the size of the notch (invisible without one).
    case hidden
    /// Thin strip around the notch with the mote on the left.
    case compact
    /// Open island with content.
    case expanded
}

/// Size and shape of the island for each mode. Pure values, tested.
enum IslandLayout {
    /// Width added on each side of the notch in compact mode.
    static let compactSideWidth: CGFloat = 40
    static let expandedSize = CGSize(width: 520, height: 170)
    /// Radius of the concave "shoulders" that blend the island into the top edge.
    static let shoulderRadius: CGFloat = 8
    /// Extra margin around the island where the pointer still counts as inside.
    static let hoverMargin: CGFloat = 4
    /// Fixed size of the transparent panel that hosts the island. Larger than any mode.
    static let panelSize = CGSize(width: 640, height: 260)

    static func size(for mode: IslandMode, notch: CGSize) -> CGSize {
        switch mode {
        case .hidden:
            return notch
        case .compact:
            return CGSize(width: notch.width + compactSideWidth * 2, height: notch.height)
        case .expanded:
            return CGSize(
                width: max(expandedSize.width, notch.width + compactSideWidth * 2),
                height: max(expandedSize.height, notch.height)
            )
        }
    }

    static func bottomCornerRadius(for mode: IslandMode, notch: CGSize) -> CGFloat {
        switch mode {
        case .hidden, .compact: return min(10, notch.height / 2)
        case .expanded: return 24
        }
    }

    /// Whether the island is drawn at all. Without a notch, hidden means invisible.
    static func isVisible(_ mode: IslandMode, hasNotch: Bool) -> Bool {
        mode != .hidden || hasNotch
    }

    /// Screen rect where the pointer counts as being on the island.
    static func hoverRect(for mode: IslandMode, geometry: NotchGeometry) -> CGRect {
        let size = size(for: mode, notch: geometry.notchSize)
        let rect = geometry.topCenteredRect(size: size)
        // Grow upwards too: the pointer can rest on the very top pixel row.
        return rect.insetBy(dx: -hoverMargin, dy: -hoverMargin)
    }
}
