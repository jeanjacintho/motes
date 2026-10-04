import CoreGraphics
import Observation

/// What the island view renders. Written only by `IslandController`.
@MainActor
@Observable
final class IslandModel {
    var mode: IslandMode = .hidden
    var geometry: NotchGeometry
    /// Placeholder until real sessions arrive in M3.
    var sessionCount = 0

    init(geometry: NotchGeometry) {
        self.geometry = geometry
    }

    var size: CGSize { IslandLayout.size(for: mode, notch: geometry.notchSize) }
    var bottomCornerRadius: CGFloat { IslandLayout.bottomCornerRadius(for: mode, notch: geometry.notchSize) }
    var isVisible: Bool { IslandLayout.isVisible(mode, hasNotch: geometry.hasNotch) }
}
