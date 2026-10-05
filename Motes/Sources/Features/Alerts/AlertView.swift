import SwiftUI

/// Card shown in the open island while a session waits for the user:
/// a permission to approve or questions to answer.
struct AlertView: View {
    let alert: PendingAlert
    let model: IslandModel

    var body: some View {
        let session = model.session(id: alert.sessionID)
        VStack(alignment: .leading, spacing: 10) {
            header(session: session)
            switch alert.kind {
            case .approval(let approval):
                ApprovalCard(approval: approval) { model.onPermission?(alert.id, $0) }
            case .question(let question):
                QuestionCard(question: question) { model.onAnswers?(alert.id, $0) }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func header(session: AgentSession?) -> some View {
        HStack(spacing: 10) {
            MoteView(
                personality: session.map(model.personality(for:)) ?? MoteRegistry.personality(for: BridgeProtocol.defaultAgent),
                state: session?.state ?? .approval,
                screenAnchor: CGPoint(x: model.contentTopLeft.x + 38, y: model.contentTopLeft.y - 30),
                framesPerSecond: 30
            )
            .frame(width: 40, height: 40)

            VStack(alignment: .leading, spacing: 1) {
                Text(session.map(model.title(for:)) ?? "Claude Code")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.6))
            }
            .lineLimit(1)

            Spacer(minLength: 8)

            if model.alerts.count > 1 {
                Text("+\(model.alerts.count - 1) waiting")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.5))
            }
            Button("Reply in Terminal") { model.onReplyInTerminal?(alert.id) }
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.55))
                .help("Answer in the terminal instead. Claude Code asks there as usual.")
        }
    }

    private var subtitle: String {
        switch alert.kind {
        case .approval(let approval): "wants to use \(approval.toolName)"
        case .question(let question): question.items.count > 1 ? "has \(question.items.count) questions" : "has a question"
        }
    }
}

// MARK: - Approval

private struct ApprovalCard: View {
    let approval: PendingAlert.Approval
    let decide: (ClaudeReply.Permission) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(approval.detail ?? approval.summary)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(.white.opacity(0.9))
                .lineLimit(3)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))

            HStack(spacing: 8) {
                Spacer()
                PillButton("Deny") { decide(.deny) }
                if let rule = approval.alwaysRule {
                    PillButton("Always Allow") { decide(.always) }
                        .help("Allow, and remember \(rule) in this project's local settings.")
                }
                PillButton("Allow", primary: true) { decide(.allow) }
            }
        }
    }
}

// MARK: - Question

private struct QuestionCard: View {
    let question: AskQuestion
    let submit: ([String: [String]]) -> Void

    @State private var index = 0
    @State private var answers: [String: [String]] = [:]
    @State private var selection: Set<String> = []

    var body: some View {
        let item = question.items[index]
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let header = item.header, !header.isEmpty {
                    Text(header.uppercased())
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white.opacity(0.6))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.white.opacity(0.1), in: Capsule())
                }
                if question.items.count > 1 {
                    Text("\(index + 1)/\(question.items.count)")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.white.opacity(0.5))
                }
                if item.multiSelect {
                    Text("Choose any")
                        .font(.system(size: 11))
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
            Text(item.question)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white)
                .lineLimit(2)

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                ForEach(item.options, id: \.label) { option in
                    OptionButton(option: option, isSelected: selection.contains(option.label)) {
                        choose(option.label, in: item)
                    }
                }
            }

            if item.multiSelect {
                HStack {
                    Spacer()
                    PillButton(index == question.items.count - 1 ? "Send" : "Next", primary: true) {
                        commit(Array(selection), for: item)
                    }
                    .disabled(selection.isEmpty)
                    .opacity(selection.isEmpty ? 0.5 : 1)
                }
            }
        }
    }

    private func choose(_ label: String, in item: AskQuestion.Item) {
        if item.multiSelect {
            if selection.contains(label) { selection.remove(label) } else { selection.insert(label) }
        } else {
            commit([label], for: item)
        }
    }

    private func commit(_ labels: [String], for item: AskQuestion.Item) {
        // Keep the options' order, not the click order.
        answers[item.question] = item.options.map(\.label).filter(labels.contains)
        selection = []
        if index + 1 < question.items.count {
            index += 1
        } else {
            submit(answers)
        }
    }
}

private struct OptionButton: View {
    let option: AskQuestion.Option
    let isSelected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(option.label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(isSelected ? .black : .white)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .padding(.horizontal, 8)
                .background(
                    isSelected ? Color.white : Color.white.opacity(hovering ? 0.16 : 0.09),
                    in: RoundedRectangle(cornerRadius: 9)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(option.description ?? option.label)
    }
}

/// Rounded island button; the primary one is light on dark.
struct PillButton: View {
    let title: String
    let primary: Bool
    let action: () -> Void
    @State private var hovering = false

    init(_ title: String, primary: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.primary = primary
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(primary ? .black : .white)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(
                    primary ? Color.white.opacity(hovering ? 1 : 0.92) : Color.white.opacity(hovering ? 0.16 : 0.09),
                    in: Capsule()
                )
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
