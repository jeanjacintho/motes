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
                    PlaceholderMote(size: notch.height * 0.62)
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
                VStack(spacing: 10) {
                    PlaceholderMote(size: 44)
                    Text(model.sessionCount > 0 ? "\(model.sessionCount) running" : "Nothing running yet.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.75))
                }
                .padding(.top, notch.height)
                .frame(maxHeight: .infinity)
                .transition(.opacity.combined(with: .scale(scale: 0.96)).animation(.easeOut(duration: 0.2).delay(0.12)))
            }
        }
    }
}

/// Stand-in mote until the real character and style are designed (M2).
struct PlaceholderMote: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(.white.opacity(0.92))
            HStack(spacing: size * 0.2) {
                Capsule().fill(.black).frame(width: size * 0.11, height: size * 0.24)
                Capsule().fill(.black).frame(width: size * 0.11, height: size * 0.24)
            }
        }
        .frame(width: size, height: size)
    }
}
