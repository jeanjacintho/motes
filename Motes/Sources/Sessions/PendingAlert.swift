import Foundation

/// Something a session needs the user to answer from the notch.
struct PendingAlert: Identifiable, Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case approval(Approval)
        case question(AskQuestion)
    }

    struct Approval: Equatable, Sendable {
        let toolName: String
        /// "Bash npm test", "Edit App.swift"…
        let summary: String
        /// What exactly will run or change: the command, the file path…
        let detail: String?
        /// What "Always allow" would remember; `nil` when there is nothing to remember.
        let alwaysRule: String?
    }

    /// The bridge responder's ID.
    let id: UUID
    let sessionID: String
    let kind: Kind
    let receivedAt: Date
    let expiresAt: Date
    /// Kept to build the reply.
    let toolInput: Data?
    let suggestions: Data?

    static func approval(from event: HookEvent, id: UUID, at now: Date) -> PendingAlert? {
        guard event.kind == .permissionRequest, let tool = event.toolName else { return nil }
        let detail = event.toolInput["command"] ?? event.toolInput["file_path"]
            ?? event.toolInput["notebook_path"] ?? event.toolInput["url"] ?? event.toolInput["pattern"]
        let approval = Approval(
            toolName: tool,
            summary: ActivityLabel.tool(tool, input: event.toolInput),
            detail: detail,
            alwaysRule: ClaudeReply.describe(suggestions: event.permissionSuggestions)
        )
        return PendingAlert(
            id: id, sessionID: event.sessionID, kind: .approval(approval), receivedAt: now,
            expiresAt: now.addingTimeInterval(event.wait ?? BridgeProtocol.approvalWait),
            toolInput: event.rawToolInput, suggestions: event.permissionSuggestions
        )
    }

    static func question(from event: HookEvent, id: UUID, at now: Date) -> PendingAlert? {
        guard event.kind == .preToolUse, event.toolName == "AskUserQuestion",
              let input = event.rawToolInput, let question = AskQuestion.parse(input) else { return nil }
        return PendingAlert(
            id: id, sessionID: event.sessionID, kind: .question(question), receivedAt: now,
            expiresAt: now.addingTimeInterval(event.wait ?? BridgeProtocol.questionWait),
            toolInput: input, suggestions: nil
        )
    }
}

/// Alerts waiting for the user, oldest first. Pure: the controller owns the
/// bridge responders and replies when this says an alert is done.
struct AlertQueue {
    private(set) var alerts: [PendingAlert] = []

    var current: PendingAlert? { alerts.first }

    mutating func add(_ alert: PendingAlert) {
        alerts.append(alert)
    }

    @discardableResult
    mutating func remove(id: UUID) -> PendingAlert? {
        guard let index = alerts.firstIndex(where: { $0.id == id }) else { return nil }
        return alerts.remove(at: index)
    }

    /// Alerts made obsolete by a later event of their session: the turn ended or
    /// the user moved on in the terminal. Removed and returned so the caller can
    /// release their hooks.
    mutating func obsoleted(by event: HookEvent) -> [PendingAlert] {
        let movesOn: Bool
        switch event.kind {
        case .userPromptSubmit, .stop, .stopFailure, .sessionEnd: movesOn = true
        default: movesOn = false
        }
        guard movesOn else { return [] }
        let gone = alerts.filter { $0.sessionID == event.sessionID }
        alerts.removeAll { $0.sessionID == event.sessionID }
        return gone
    }

    /// Alerts whose hook has given up waiting.
    mutating func expired(at now: Date) -> [PendingAlert] {
        let gone = alerts.filter { $0.expiresAt <= now }
        alerts.removeAll { $0.expiresAt <= now }
        return gone
    }

    var nextExpiry: Date? { alerts.map(\.expiresAt).min() }
}
