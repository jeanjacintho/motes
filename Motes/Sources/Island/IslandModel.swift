import CoreGraphics
import Foundation
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
    /// Alerts waiting for the user, oldest first. The first one is shown.
    var alerts: [PendingAlert] = []
    /// Claude plan usage, shown on the open island's right shoulder.
    var usage: PlanUsage?
    /// Open pull request of each session's branch, by session ID.
    var pullRequests: [String: PullRequestStatus] = [:]
    /// Forced from the Debug menu; `nil` follows the sessions.
    var debugMoteState: MoteState?
    @ObservationIgnored var onNewMote: (() -> Void)?
    @ObservationIgnored var onOpenMote: ((Mote) -> Void)?
    @ObservationIgnored var onPermission: ((UUID, ClaudeReply.Permission) -> Void)?
    @ObservationIgnored var onAnswers: ((UUID, [String: [String]]) -> Void)?
    @ObservationIgnored var onReplyInTerminal: ((UUID) -> Void)?
    @ObservationIgnored var onJump: ((AgentSession) -> Void)?

    init(geometry: NotchGeometry) {
        self.geometry = geometry
    }

    var currentAlert: PendingAlert? { alerts.first }
    /// The open island is showing an alert card.
    var isShowingAlert: Bool { mode == .expanded && currentAlert != nil }

    /// The edit open in the diff card: its session and its ID.
    var shownDiff: (sessionID: String, changeID: UUID)?
    @ObservationIgnored var onShowDiff: ((String, UUID) -> Void)?

    var isShowingDiff: Bool { mode == .expanded && currentAlert == nil && shownDiffSession != nil }

    /// The session whose edit is open, while that edit still exists.
    var shownDiffSession: AgentSession? {
        guard let shownDiff, let session = session(id: shownDiff.sessionID),
              session.changes.contains(where: { $0.id == shownDiff.changeID }) else { return nil }
        return session
    }

    /// Alerts and diffs need more room than the session list.
    var isTall: Bool { isShowingAlert || isShowingDiff }

    func session(id: String) -> AgentSession? {
        sessions.first { $0.id == id }
    }

    var size: CGSize { IslandLayout.size(for: mode, notch: geometry.notchSize, isAlert: isTall) }
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
        debugMoteState ?? adjusted(focused?.state ?? .idle, agent: focused?.agent ?? BridgeProtocol.defaultAgent)
    }

    func state(of session: AgentSession) -> MoteState {
        debugMoteState ?? adjusted(session.state, agent: session.agent)
    }

    private func adjusted(_ state: MoteState, agent: String) -> MoteState {
        usage?.adjusted(state, agent: agent) ?? state
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
