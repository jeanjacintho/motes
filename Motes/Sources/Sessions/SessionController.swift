import Foundation
import os

/// Glue between the bridge, the session store, the alerts and the UI. Main actor only.
@MainActor
final class SessionController {
    private var store = SessionStore()
    private var alerts = AlertQueue()
    /// Open connections of hooks waiting for an answer, by alert ID.
    private var responders: [UUID: BridgeResponder] = [:]
    private var server: BridgeServer?
    private var tickTask: Task<Void, Never>?
    private let log = Logger(subsystem: "app.motes", category: "sessions")

    /// Finds the mote owning a folder, for sessions started outside Motes.
    var moteForFolder: ((String) -> String?)?

    /// Called whenever something changes: sessions, the focused one, and pending alerts (oldest first).
    var onChange: (([AgentSession], AgentSession?, [PendingAlert]) -> Void)?

    var sessions: [AgentSession] { store.sessions }

    func start() {
        let server = BridgeServer(path: BridgeProtocol.socketURL.path) { [weak self] data, responder in
            Task { @MainActor in self?.receive(data, responder: responder) }
        } onHangUp: { [weak self] id in
            Task { @MainActor in self?.hookHungUp(id) }
        }
        do {
            try server.start()
            self.server = server
        } catch {
            log.error("Bridge failed to start: \(String(describing: error), privacy: .public)")
        }
    }

    func stop() {
        // Let every waiting agent fall back to its terminal right away.
        for responder in responders.values { responder.reply(nil) }
        responders.removeAll()
        server?.stop()
        server = nil
        tickTask?.cancel()
    }

    func receive(_ data: Data, responder: BridgeResponder? = nil) {
        guard let event = HookEvent.parse(data) else {
            log.debug("Ignored a message that isn't a hook event")
            responder?.reply(nil)
            return
        }
        log.debug("\(String(describing: event.kind), privacy: .public) from \(event.agent, privacy: .public)")
        if let responder { enqueue(event, responder: responder) }
        apply(event)
    }

    func apply(_ event: HookEvent) {
        var event = event
        if event.moteID == nil, let cwd = event.cwd {
            event.moteID = moteForFolder?(cwd)
        }
        for alert in alerts.obsoleted(by: event) { release(alert.id, reply: nil) }
        store.apply(event, at: .now)
        refresh()
    }

    // MARK: - Answers

    func answer(_ alertID: UUID, permission: ClaudeReply.Permission) {
        guard let alert = alerts.remove(id: alertID) else { return }
        release(alertID, reply: ClaudeReply.permission(permission, suggestions: alert.suggestions))
        refresh()
    }

    func answer(_ alertID: UUID, answers: [String: [String]]) {
        guard let alert = alerts.remove(id: alertID), let input = alert.toolInput else { return }
        release(alertID, reply: ClaudeReply.answers(answers, toolInput: input))
        refresh()
    }

    /// Leaves the decision to the terminal: the hook prints nothing.
    func replyInTerminal(_ alertID: UUID) {
        guard alerts.remove(id: alertID) != nil else { return }
        release(alertID, reply: nil)
        refresh()
    }

    // MARK: - Alerts

    private func enqueue(_ event: HookEvent, responder: BridgeResponder) {
        let now = Date.now
        // Only Claude Code's replies are understood for now; other agents ask in their terminal.
        let alert = event.agent == BridgeProtocol.defaultAgent
            ? (PendingAlert.approval(from: event, id: responder.id, at: now)
                ?? PendingAlert.question(from: event, id: responder.id, at: now))
            : nil
        guard let alert else {
            responder.reply(nil)
            return
        }
        responders[alert.id] = responder
        alerts.add(alert)
        log.debug("Waiting for the user: \(String(describing: event.kind), privacy: .public)")
    }

    private func hookHungUp(_ id: UUID) {
        log.debug("A waiting hook gave up")
        responders[id] = nil
        if alerts.remove(id: id) != nil { refresh() }
    }

    private func release(_ id: UUID, reply: Data?) {
        responders.removeValue(forKey: id)?.reply(reply)
    }

    // MARK: - Debug helpers

    private var fakeCount = 0

    /// Starts a fake session for the next automatic mote.
    func debugAddFakeSession() {
        let agent = MoteRegistry.all[fakeCount % MoteRegistry.all.count].id
        fakeCount += 1
        let id = "debug-\(fakeCount)"
        var start = HookEvent(kind: .sessionStart, sessionID: id, agent: agent)
        start.cwd = "/tmp/demo-\(agent)"
        apply(start)
        var edit = HookEvent(kind: .preToolUse, sessionID: id, agent: agent)
        edit.toolName = "Edit"
        edit.toolInput = ["file_path": "/tmp/demo-\(agent)/Sources/App.swift"]
        apply(edit)
    }

    func debugClearFakeSessions() {
        for session in store.sessions where session.id.hasPrefix("debug-") {
            apply(HookEvent(kind: .sessionEnd, sessionID: session.id, agent: session.agent))
        }
    }

    // MARK: - Timing

    private func refresh() {
        let now = Date.now
        store.tick(at: now)
        for alert in alerts.expired(at: now) { release(alert.id, reply: nil) }
        onChange?(store.sessions, store.focused, alerts.alerts)
        scheduleTick(after: now)
    }

    /// Sleeps until the next time-based rule applies; nothing runs in between.
    private func scheduleTick(after now: Date) {
        tickTask?.cancel()
        let deadline = [store.nextDeadline(after: now), alerts.nextExpiry].compactMap { $0 }.min()
        guard let deadline else { return }
        tickTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0.05, deadline.timeIntervalSinceNow)))
            guard !Task.isCancelled else { return }
            self?.refresh()
        }
    }
}
