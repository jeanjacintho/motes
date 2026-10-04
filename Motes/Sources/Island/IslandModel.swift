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
    /// Forced from the Debug menu; `nil` follows the sessions.
    var debugMoteState: MoteState?

    init(geometry: NotchGeometry) {
        self.geometry = geometry
    }

    var size: CGSize { IslandLayout.size(for: mode, notch: geometry.notchSize) }
    var bottomCornerRadius: CGFloat { IslandLayout.bottomCornerRadius(for: mode, notch: geometry.notchSize) }
    var isVisible: Bool { IslandLayout.isVisible(mode, hasNotch: geometry.hasNotch) }

    /// Mote shown in the compact island. Real sessions pick it from M3.
    var primaryMote: MotePersonality { MoteRegistry.personality(for: "claude") }

    var moteState: MoteState {
        debugMoteState ?? (sessionCount > 0 ? .working : .idle)
    }

    /// Screen point where the mote is drawn, so its eyes can follow the pointer.
    var moteScreenAnchor: CGPoint {
        let frame = geometry.screenFrame
        let notch = geometry.notchSize
        switch mode {
        case .hidden, .compact:
            let left = frame.midX - size.width / 2
            return CGPoint(x: left + IslandLayout.compactSideWidth / 2, y: frame.maxY - notch.height / 2)
        case .expanded:
            return CGPoint(x: frame.midX, y: frame.maxY - notch.height - (size.height - notch.height) / 2 + 12)
        }
    }
}
