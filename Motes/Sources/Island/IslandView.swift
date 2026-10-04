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
                .clipped()
        }
        .contentShape(IslandShape(bottomRadius: model.bottomCornerRadius, shoulderRadius: shoulder))
        .onTapGesture(perform: onTap)
        .opacity(model.isVisible ? 1 : 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(model.mode == .expanded ? Self.openAnimation : Self.closeAnimation, value: model.mode)
        .animation(Self.closeAnimation, value: model.geometry)
    }
}

/// Mode-specific content. Real views (overview, approval…) come in later milestones.
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
                    .frame(width: IslandLayout.compactSideWidth)
                    Spacer(minLength: 0)
                    Text(model.sessionCount > 0 ? "\(model.sessionCount)" : "")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.7))
                        .frame(width: IslandLayout.compactSideWidth)
                }
                .frame(height: notch.height)
                .transition(.opacity)
            }

            if model.mode == .expanded {
                VStack(spacing: 2) {
                    // Until sessions arrive (M3), the open island shows the whole family.
                    HStack(spacing: 0) {
                        ForEach(Array(MoteRegistry.all.enumerated()), id: \.element.id) { index, mote in
                            MoteView(
                                personality: mote,
                                state: model.moteState,
                                screenAnchor: lineupAnchor(index: index),
                                framesPerSecond: 30
                            )
                            .frame(width: Self.lineupSlot, height: Self.lineupSlot)
                        }
                    }
                    Text(statusText)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.75))
                }
                .padding(.top, notch.height)
                .frame(maxHeight: .infinity)
                .transition(.opacity.combined(with: .scale(scale: 0.96)).animation(.easeOut(duration: 0.2).delay(0.12)))
            }
        }
    }

    private static let lineupSlot: CGFloat = 84

    private func lineupAnchor(index: Int) -> CGPoint {
        let anchor = model.moteScreenAnchor
        let offset = (CGFloat(index) - CGFloat(MoteRegistry.all.count - 1) / 2) * Self.lineupSlot
        return CGPoint(x: anchor.x + offset, y: anchor.y)
    }

    private var statusText: String {
        if let state = model.debugMoteState { return "Debug: \(state.rawValue)" }
        return model.sessionCount > 0 ? "\(model.sessionCount) running" : "Nothing running yet."
    }
}
