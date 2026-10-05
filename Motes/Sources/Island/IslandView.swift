import SwiftUI

/// Root view of the island panel. The island hangs from the top center.
struct IslandView: View {
    let model: IslandModel
    let onTap: () -> Void

    private static let openAnimation = Animation.spring(response: 0.45, dampingFraction: 0.75)
    private static let closeAnimation = Animation.spring(response: 0.35, dampingFraction: 1)

    var body: some View {
        let size = model.size
        let shoulder = IslandLayout.shoulderRadius

        ZStack(alignment: .top) {
            IslandShape(bottomRadius: model.bottomCornerRadius, shoulderRadius: shoulder)
                .fill(.black)
                .frame(width: size.width + shoulder * 2, height: size.height)

            IslandContent(model: model)
                .frame(width: size.width, height: size.height)
                // Clip to the island's own outline, rounded bottom corners included:
                // content leaving mid-transition must never show outside the black shape.
                .clipShape(IslandShape(bottomRadius: model.bottomCornerRadius, shoulderRadius: 0))
        }
        .contentShape(IslandShape(bottomRadius: model.bottomCornerRadius, shoulderRadius: shoulder))
        .onTapGesture(perform: onTap)
        .opacity(model.isVisible ? 1 : 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(model.mode == .expanded ? Self.openAnimation : Self.closeAnimation, value: model.mode)
        // An alert arriving or being answered resizes the open island.
        .animation(Self.openAnimation, value: model.isShowingAlert)
        .animation(Self.closeAnimation, value: model.geometry)
    }
}

/// Mode-specific content.
private struct IslandContent: View {
    let model: IslandModel

    var body: some View {
        let notch = model.geometry.notchSize

        ZStack(alignment: .top) {
            if model.mode == .compact {
                HStack(spacing: 0) {
                    MoteView(
                        personality: model.primaryMote,
                        state: model.moteState,
                        screenAnchor: model.moteScreenAnchor,
                        framesPerSecond: 30
                    )
                    .frame(width: notch.height, height: notch.height)
                    // A new animator when the focused mote changes: its rhythm is per mote.
                    .id(model.primaryMote.id)
                    .frame(width: IslandLayout.compactSideWidth)
                    Spacer(minLength: 0)
                    Text(model.sessions.count > 1 ? "\(model.sessions.count)" : "")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.7))
                        .frame(width: IslandLayout.compactSideWidth)
                }
                .frame(height: notch.height)
                .transition(.opacity)
            }

            if model.mode == .expanded {
                // A ZStack, not a Group: modifiers on a Group apply to each child, so the
                // delayed open/close transition below would also run when an alert is
                // swapped for the session list, leaving the old card on screen.
                ZStack(alignment: .top) {
                    if let alert = model.currentAlert {
                        AlertView(alert: alert, model: model)
                            .id(alert.id)
                    } else if model.sessions.isEmpty {
                        FamilyView(model: model)
                    } else {
                        SessionListView(model: model)
                    }
                }
                .padding(.top, notch.height)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.opacity.combined(with: .scale(scale: 0.96)).animation(.easeOut(duration: 0.2).delay(0.12)))
            }
        }
    }
}

/// Open island with nothing running: the user's motes (click one to open its
/// terminal) and a button to create one. Before any mote exists, the automatic
/// motes say hello.
private struct FamilyView: View {
    let model: IslandModel
    static let maxMotes = 5
    private static let slot: CGFloat = 80

    var body: some View {
        let shown = Array(model.motes.prefix(Self.maxMotes))
        VStack(spacing: 2) {
            HStack(spacing: 0) {
                if shown.isEmpty {
                    ForEach(Array(MoteRegistry.all.enumerated()), id: \.element.id) { index, mote in
                        moteView(mote, index: index, count: MoteRegistry.all.count + 1)
                    }
                } else {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, mote in
                        Button { model.onOpenMote?(mote) } label: {
                            VStack(spacing: -10) {
                                moteView(mote.personality, index: index, count: shown.count + 1)
                                Text(mote.name)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(.white.opacity(0.8))
                                    .lineLimit(1)
                                    .frame(width: Self.slot - 6)
                            }
                        }
                        .buttonStyle(.plain)
                        .help("Open \(mote.name) in Terminal")
                    }
                }
                NewMoteButton { model.onNewMote?() }
                    .frame(width: Self.slot, height: Self.slot)
            }
            Text(caption(isEmpty: shown.isEmpty))
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.6))
        }
        .frame(maxHeight: .infinity)
    }

    private func moteView(_ personality: MotePersonality, index: Int, count: Int) -> some View {
        MoteView(
            personality: personality,
            state: model.debugMoteState ?? .idle,
            screenAnchor: anchor(index: index, count: count),
            framesPerSecond: 30
        )
        .frame(width: Self.slot, height: Self.slot)
    }

    private func caption(isEmpty: Bool) -> String {
        if let state = model.debugMoteState { return "Debug: \(state.rawValue)" }
        return isEmpty ? "Create a mote to start an agent in a folder." : "Nothing running. Click a mote to open its terminal."
    }

    private func anchor(index: Int, count: Int) -> CGPoint {
        let anchor = model.moteScreenAnchor
        let offset = (CGFloat(index) - CGFloat(count - 1) / 2) * Self.slot
        return CGPoint(x: anchor.x + offset, y: anchor.y)
    }
}

private struct NewMoteButton: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .strokeBorder(.white.opacity(hovering ? 0.6 : 0.3), style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                    .frame(width: 38, height: 38)
                Image(systemName: "plus")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white.opacity(hovering ? 0.9 : 0.6))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help("New Mote")
    }
}

/// Open island with sessions: one row per session, focused first.
private struct SessionListView: View {
    let model: IslandModel
    static let maxRows = 3
    static let rowHeight: CGFloat = 40

    var body: some View {
        let sessions = ordered
        VStack(spacing: 0) {
            ForEach(Array(sessions.prefix(Self.maxRows).enumerated()), id: \.element.id) { index, session in
                SessionRow(
                    title: model.title(for: session),
                    session: session,
                    personality: model.personality(for: session),
                    state: model.state(of: session),
                    anchor: anchor(row: index)
                )
                    .frame(height: Self.rowHeight)
            }
            if sessions.count > Self.maxRows {
                Text("+\(sessions.count - Self.maxRows) more")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 8)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var ordered: [AgentSession] {
        guard let focused = model.focused else { return model.sessions }
        return [focused] + model.sessions.filter { $0.id != focused.id }
    }

    private func anchor(row: Int) -> CGPoint {
        let origin = model.contentTopLeft
        return CGPoint(x: origin.x + 18 + SessionRow.moteSize / 2,
                       y: origin.y - 8 - Self.rowHeight * (CGFloat(row) + 0.5))
    }
}

private struct SessionRow: View {
    let title: String
    let session: AgentSession
    let personality: MotePersonality
    let state: MoteState
    let anchor: CGPoint
    static let moteSize: CGFloat = 40

    var body: some View {
        HStack(spacing: 10) {
            MoteView(
                personality: personality,
                state: state,
                screenAnchor: anchor,
                framesPerSecond: 30
            )
            .frame(width: Self.moteSize, height: Self.moteSize)

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Text(session.latestActivity ?? "Ready")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.6))
            }
            .lineLimit(1)
            .truncationMode(.tail)

            Spacer(minLength: 8)

            Text(Self.label(for: state))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(MoteStateStyle.of(state).color.color)
        }
    }

    static func label(for state: MoteState) -> String {
        switch state {
        case .idle: "Idle"
        case .working: "Working"
        case .thinking: "Thinking"
        case .approval: "Needs approval"
        case .question: "Has a question"
        case .error: "Error"
        case .finished: "Done"
        case .tired: "Tired"
        case .sleeping: "Asleep"
        }
    }
}
