import Foundation
import os

/// Glue between the bridge, the session store and the UI. Main actor only.
@MainActor
final class SessionController {
    private var store = SessionStore()
    private var server: BridgeServer?
    private var tickTask: Task<Void, Never>?
    private let log = Logger(subsystem: "app.motes", category: "sessions")

    /// Finds the mote owning a folder, for sessions started outside Motes.
    var moteForFolder: ((String) -> String?)?

    /// Called whenever sessions change: (all sessions, focused one).
    var onChange: (([AgentSession], AgentSession?) -> Void)?

    var sessions: [AgentSession] { store.sessions }

    func start() {
        let server = BridgeServer(path: BridgeProtocol.socketURL.path) { [weak self] data in
            Task { @MainActor in self?.receive(data) }
        }
        do {
            try server.start()
            self.server = server
        } catch {
            log.error("Bridge failed to start: \(String(describing: error), privacy: .public)")
        }
    }

    func stop() {
        server?.stop()
        server = nil
        tickTask?.cancel()
    }

    func receive(_ data: Data) {
        guard let event = HookEvent.parse(data) else {
            log.debug("Ignored a message that isn't a hook event")
            return
        }
        log.debug("\(String(describing: event.kind), privacy: .public) from \(event.agent, privacy: .public)")
        apply(event)
    }

    func apply(_ event: HookEvent) {
        var event = event
        if event.moteID == nil, let cwd = event.cwd {
            event.moteID = moteForFolder?(cwd)
        }
        store.apply(event, at: .now)
        refresh()
    }

    // MARK: - Debug helpers

    private var fakeCount = 0

    /// Starts a fake session for the next mote in the registry.
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
        onChange?(store.sessions, store.focused)
        scheduleTick(after: now)
    }

    /// Sleeps until the next time-based rule applies; nothing runs in between.
    private func scheduleTick(after now: Date) {
        tickTask?.cancel()
        guard let deadline = store.nextDeadline(after: now) else { return }
        tickTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0.05, deadline.timeIntervalSinceNow)))
            guard !Task.isCancelled else { return }
            self?.refresh()
        }
    }
}
