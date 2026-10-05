import Foundation

/// Turns hook events into sessions. Pure: time is passed in, so every rule is testable.
struct SessionStore {
    private(set) var sessions: [AgentSession] = []

    struct Timing: Equatable {
        /// How long a finished session celebrates before going idle.
        var finishedHold: TimeInterval = 5
        /// Quiet sessions fall asleep after this long.
        var sleepAfter: TimeInterval = 10 * 60
        /// Sessions that never sent SessionEnd (crash, killed terminal) are forgotten after this long.
        var forgetAfter: TimeInterval = 2 * 60 * 60
    }

    var timing = Timing()

    mutating func apply(_ event: HookEvent, at now: Date) {
        if event.kind == .sessionEnd {
            sessions.removeAll { $0.id == event.sessionID }
            return
        }

        var session = sessions.first { $0.id == event.sessionID } ?? AgentSession(
            id: event.sessionID, agent: event.agent, name: Self.name(cwd: event.cwd, agent: event.agent),
            cwd: event.cwd, state: .idle, startedAt: now, lastEventAt: now, stateChangedAt: now
        )
        session.lastEventAt = now
        if let cwd = event.cwd, cwd != session.cwd {
            session.cwd = cwd
            session.name = Self.name(cwd: cwd, agent: session.agent)
        }
        if !event.terminal.isEmpty { session.terminal = event.terminal }
        if let moteID = event.moteID { session.moteID = moteID }

        switch event.kind {
        case .sessionStart:
            set(&session, .idle, at: now)

        case .userPromptSubmit:
            set(&session, .thinking, at: now)
            if let prompt = event.prompt { push(&session, ActivityLabel.prompt(prompt)) }

        case .preToolUse:
            if event.toolName == "AskUserQuestion" {
                set(&session, .question, at: now)
            } else {
                set(&session, .working, at: now)
                if let tool = event.toolName { push(&session, ActivityLabel.tool(tool, input: event.toolInput)) }
            }

        case .postToolUse, .postToolUseFailure:
            set(&session, .working, at: now)

        case .permissionRequest:
            set(&session, .approval, at: now)

        case .notification:
            if let state = Self.state(forNotification: event) { set(&session, state, at: now) }

        case .stop:
            set(&session, .finished, at: now)
            if let summary = event.lastAssistantMessage.flatMap(ActivityLabel.summary) { push(&session, summary) }

        case .stopFailure:
            set(&session, .error, at: now)

        case .subagentStart:
            push(&session, "+ subagent")

        case .subagentStop:
            push(&session, "✓ subagent")

        case .interrupt:
            set(&session, .idle, at: now)
            push(&session, "Interrupted")

        case .sessionEnd, .other:
            break
        }

        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        } else {
            sessions.append(session)
        }
    }

    /// Applies time-based rules: finished → idle, quiet → sleeping, stale → forgotten.
    mutating func tick(at now: Date) {
        sessions.removeAll { now.timeIntervalSince($0.lastEventAt) >= timing.forgetAfter }
        for index in sessions.indices {
            var session = sessions[index]
            if session.state == .finished, now.timeIntervalSince(session.stateChangedAt) >= timing.finishedHold {
                set(&session, .idle, at: now)
            }
            if !session.state.isAlert, session.state != .sleeping,
               now.timeIntervalSince(session.lastEventAt) >= timing.sleepAfter {
                set(&session, .sleeping, at: now)
            }
            sessions[index] = session
        }
    }

    /// Next moment `tick` would change something, so the caller can sleep until then.
    /// Call `tick(at:)` first: only future deadlines are returned.
    func nextDeadline(after now: Date) -> Date? {
        var deadlines: [Date] = []
        for session in sessions {
            deadlines.append(session.lastEventAt.addingTimeInterval(timing.forgetAfter))
            if session.state == .finished {
                deadlines.append(session.stateChangedAt.addingTimeInterval(timing.finishedHold))
            }
            if !session.state.isAlert, session.state != .sleeping {
                deadlines.append(session.lastEventAt.addingTimeInterval(timing.sleepAfter))
            }
        }
        return deadlines.filter { $0 > now }.min()
    }

    /// The session the big mote represents: the latest alert, otherwise the
    /// latest busy session, otherwise the latest active one.
    var focused: AgentSession? {
        if let alert = sessions.filter({ $0.state.isAlert }).max(by: { $0.stateChangedAt < $1.stateChangedAt }) {
            return alert
        }
        let busy: Set<MoteState> = [.working, .thinking, .finished]
        if let active = sessions.filter({ busy.contains($0.state) }).max(by: { $0.lastEventAt < $1.lastEventAt }) {
            return active
        }
        return sessions.max { $0.lastEventAt < $1.lastEventAt }
    }

    // MARK: - Helpers

    private func set(_ session: inout AgentSession, _ state: MoteState, at now: Date) {
        guard session.state != state else { return }
        session.state = state
        session.stateChangedAt = now
    }

    private func push(_ session: inout AgentSession, _ line: String) {
        session.feed.append(line)
        if session.feed.count > AgentSession.maxFeed {
            session.feed.removeFirst(session.feed.count - AgentSession.maxFeed)
        }
    }

    private static func name(cwd: String?, agent: String) -> String {
        guard let cwd, !cwd.isEmpty else { return MoteRegistry.personality(for: agent).name }
        let folder = (cwd as NSString).lastPathComponent
        return folder.isEmpty || folder == "/" ? cwd : folder
    }

    private static func state(forNotification event: HookEvent) -> MoteState? {
        let message = event.message?.lowercased() ?? ""
        if message.contains("usage limit") || message.contains("rate limit") { return .tired }
        switch event.notificationType {
        case "permission_prompt": return .approval
        case "idle_prompt": return .idle
        default: return message.contains("permission") ? .approval : nil
        }
    }
}
