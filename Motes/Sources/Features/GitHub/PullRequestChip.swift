import AppKit
import SwiftUI

/// A session's pull request in its row: number, checks and review. Opens the
/// pull request on GitHub.
struct PullRequestChip: View {
    let pullRequest: PullRequestStatus
    @State private var hovering = false

    var body: some View {
        Button {
            NSWorkspace.shared.open(pullRequest.url)
        } label: {
            label
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help)
    }

    private var label: some View {
        let textOpacity: Double = pullRequest.isDraft ? 0.45 : 0.75
        let backgroundOpacity: Double = hovering ? 0.16 : 0.08
        return HStack(spacing: 4) {
            // Verbatim: a localized number would read "#1.280".
            Text(verbatim: "#\(pullRequest.number)")
            symbol(ciSymbol)
            symbol(reviewSymbol)
        }
        .font(.system(size: 11, weight: .semibold, design: .rounded))
        .foregroundStyle(Color.white.opacity(textOpacity))
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Color.white.opacity(backgroundOpacity), in: Capsule())
        .contentShape(Capsule())
    }

    @ViewBuilder
    private func symbol(_ symbol: (name: String, color: Color)?) -> some View {
        if let symbol {
            Image(systemName: symbol.name).foregroundStyle(symbol.color)
        }
    }

    private var ciSymbol: (name: String, color: Color)? {
        switch pullRequest.ci {
        case .none: nil
        case .pending: ("circle.dotted", MotePalette.amber.color.color)
        case .success: ("checkmark.circle.fill", ChangeCounts.addedColor)
        case .failure: ("xmark.circle.fill", MotePalette.coral.color.color)
        }
    }

    private var reviewSymbol: (name: String, color: Color)? {
        switch pullRequest.review {
        case .none: nil
        case .approved: ("hand.thumbsup.fill", ChangeCounts.addedColor)
        case .changesRequested: ("exclamationmark.bubble.fill", MotePalette.coral.color.color)
        }
    }

    private var help: String {
        var lines = ["#\(pullRequest.number) \(pullRequest.title)" + (pullRequest.isDraft ? " (draft)" : "")]
        switch pullRequest.ci {
        case .none: break
        case .pending: lines.append("Checks running")
        case .success: lines.append("Checks passed")
        case .failure: lines.append("Checks failed")
        }
        switch pullRequest.review {
        case .none: break
        case .approved: lines.append("Approved")
        case .changesRequested: lines.append("Changes requested")
        }
        lines.append("Click to open on GitHub")
        return lines.joined(separator: "\n")
    }
}
