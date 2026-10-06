import SwiftUI

/// The diff of one edit, in the open island: header with the file and its
/// counts, arrows to step through the session's edits, and the changed lines.
struct DiffCardView: View {
    let session: AgentSession
    let changeID: UUID
    let onSelect: (UUID) -> Void
    let onBack: () -> Void

    var body: some View {
        let changes = session.changes
        let index = changes.firstIndex { $0.id == changeID } ?? max(changes.count - 1, 0)
        VStack(alignment: .leading, spacing: 8) {
            if changes.indices.contains(index) {
                header(changes[index], index: index, count: changes.count)
                lines(changes[index])
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func header(_ change: FileChange, index: Int, count: Int) -> some View {
        HStack(spacing: 8) {
            IconButton(systemName: "chevron.left", help: "Back to the sessions", action: onBack)
            Text(change.fileName)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .help(change.path)
            ChangeCounts(change: change)
            Spacer(minLength: 8)
            if count > 1 {
                IconButton(systemName: "chevron.up", help: "Previous edit", disabled: index == 0) {
                    onSelect(session.changes[index - 1].id)
                }
                Text("\(index + 1) of \(count)")
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                    .foregroundStyle(.white.opacity(0.5))
                IconButton(systemName: "chevron.down", help: "Next edit", disabled: index == count - 1) {
                    onSelect(session.changes[index + 1].id)
                }
            }
        }
    }

    @ViewBuilder
    private func lines(_ change: FileChange) -> some View {
        if let lines = change.lines, !lines.isEmpty {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        DiffLineView(line: line)
                    }
                }
                .textSelection(.enabled)
            }
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            Text(change.lines == nil ? "This edit is too large to show." : "No line changed.")
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.5))
        }
    }
}

private struct DiffLineView: View {
    let line: FileChange.Line

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(marker)
                .foregroundStyle(color.opacity(0.9))
                .frame(width: 8)
            Text(line.kind == .gap ? "⋯" : line.text)
                .foregroundStyle(line.kind == .gap ? .white.opacity(0.35) : .white.opacity(0.88))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .font(.system(size: 10.5, design: .monospaced))
        .padding(.horizontal, 8)
        .padding(.vertical, 1)
        .background(background)
    }

    private var marker: String {
        switch line.kind {
        case .added: "+"
        case .removed: "−"
        case .context, .gap: " "
        }
    }

    private var color: Color {
        switch line.kind {
        case .added: ChangeCounts.addedColor
        case .removed: ChangeCounts.removedColor
        case .context, .gap: .white
        }
    }

    private var background: Color {
        switch line.kind {
        case .added: ChangeCounts.addedColor.opacity(0.12)
        case .removed: ChangeCounts.removedColor.opacity(0.12)
        case .context, .gap: .clear
        }
    }
}

/// "+12 −3" in green and red.
struct ChangeCounts: View {
    let change: FileChange
    static let addedColor = Color(.sRGB, red: 0.13, green: 0.77, blue: 0.37)
    static let removedColor = Color(.sRGB, red: 0.96, green: 0.31, blue: 0.37)

    var body: some View {
        HStack(spacing: 4) {
            Text("+\(change.added)").foregroundStyle(Self.addedColor)
            Text("−\(change.removed)").foregroundStyle(Self.removedColor)
        }
        .font(.system(size: 11, weight: .semibold, design: .monospaced))
    }
}

/// Small round icon button for the island's dark background.
private struct IconButton: View {
    let systemName: String
    let help: String
    var disabled = false
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white.opacity(disabled ? 0.25 : 0.8))
                .frame(width: 22, height: 22)
                .background(Color.white.opacity(hovering && !disabled ? 0.16 : 0.08), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .onHover { hovering = $0 }
        .help(help)
    }
}
