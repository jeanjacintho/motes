import CoreGraphics
import Observation

/// What the island view renders. Written only by `IslandController`.
@MainActor
@Observable
final class IslandModel {
    var mode: IslandMode = .hidden
    var geometry: NotchGeometry
    var sessions: [AgentSession] = []
    /// The session the big mote represents.
    var focused: AgentSession?
    /// Motes the user created.
    var motes: [Mote] = []
    /// Forced from the Debug menu; `nil` follows the sessions.
    var debugMoteState: MoteState?
    @ObservationIgnored var onNewMote: (() -> Void)?
    @ObservationIgnored var onOpenMote: ((Mote) -> Void)?

    init(geometry: NotchGeometry) {
        self.geometry = geometry
    }

    var size: CGSize { IslandLayout.size(for: mode, notch: geometry.notchSize) }
    var bottomCornerRadius: CGFloat { IslandLayout.bottomCornerRadius(for: mode, notch: geometry.notchSize) }
    var isVisible: Bool { IslandLayout.isVisible(mode, hasNotch: geometry.hasNotch) }

    /// Mote shown in the compact island: the focused session's.
    var primaryMote: MotePersonality {
        focused.map(personality(for:)) ?? MoteRegistry.personality(for: BridgeProtocol.defaultAgent)
    }

    /// The user's mote for a session, or the agent's automatic mote.
    func personality(for session: AgentSession) -> MotePersonality {
        mote(for: session)?.personality ?? MoteRegistry.personality(for: session.agent)
    }

    func mote(for session: AgentSession) -> Mote? {
        session.moteID.flatMap { id in motes.first { $0.id == id } }
    }

    /// The mote's name when it has one, otherwise the folder's.
    func title(for session: AgentSession) -> String {
        mote(for: session)?.name ?? session.name
    }

    var moteState: MoteState {
        debugMoteState ?? focused?.state ?? .idle
    }

    func state(of session: AgentSession) -> MoteState {
        debugMoteState ?? session.state
    }

    /// Screen point where the compact mote is drawn, so its eyes can follow the pointer.
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

    /// Top-left of the open island's content area, in screen coordinates.
    var contentTopLeft: CGPoint {
        let frame = geometry.screenFrame
        return CGPoint(x: frame.midX - size.width / 2, y: frame.maxY - geometry.notchSize.height)
    }
}
