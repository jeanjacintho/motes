import Foundation
import Testing
@testable import Motes

struct SessionStoreTests {
    let t0 = Date(timeIntervalSinceReferenceDate: 1_000_000)

    func event(_ kind: HookEvent.Kind, _ id: String = "s1", agent: String = "claude",
               configure: (inout HookEvent) -> Void = { _ in }) -> HookEvent {
        var e = HookEvent(kind: kind, sessionID: id, agent: agent)
        e.cwd = "/Users/me/code/motes"
        configure(&e)
        return e
    }

    @Test func sessionLifecycle() throws {
        var store = SessionStore()
        store.apply(event(.sessionStart), at: t0)
        var s = try #require(store.sessions.first)
        #expect(s.name == "motes")
        #expect(s.state == .idle)

        store.apply(event(.userPromptSubmit) { $0.prompt = "Add tests" }, at: t0 + 1)
        #expect(store.sessions[0].state == .thinking)
        #expect(store.sessions[0].latestActivity == "› Add tests")

        store.apply(event(.preToolUse) { $0.toolName = "Edit"; $0.toolInput = ["file_path": "/x/App.swift"] }, at: t0 + 2)
        s = store.sessions[0]
        #expect(s.state == .working)
        #expect(s.latestActivity == "Edit App.swift")

        store.apply(event(.stop) { $0.lastAssistantMessage = "All done." }, at: t0 + 3)
        #expect(store.sessions[0].state == .finished)
        #expect(store.sessions[0].latestActivity == "All done.")

        store.apply(event(.sessionEnd), at: t0 + 4)
        #expect(store.sessions.isEmpty)
    }

    @Test func eventsWithoutSessionStartCreateTheSession() {
        var store = SessionStore()
        store.apply(event(.preToolUse, "late") { $0.toolName = "Bash" }, at: t0)
        #expect(store.sessions.map(\.id) == ["late"])
        #expect(store.sessions[0].state == .working)
    }

    @Test func alerts() {
        var store = SessionStore()
        store.apply(event(.permissionRequest) { $0.toolName = "Bash" }, at: t0)
        #expect(store.sessions[0].state == .approval)
        store.apply(event(.preToolUse) { $0.toolName = "AskUserQuestion" }, at: t0 + 1)
        #expect(store.sessions[0].state == .question)
        store.apply(event(.stopFailure), at: t0 + 2)
        #expect(store.sessions[0].state == .error)
    }

    @Test func notifications() {
        var store = SessionStore()
        store.apply(event(.notification) { $0.message = "Claude usage limit reached" }, at: t0)
        #expect(store.sessions[0].state == .tired)
        store.apply(event(.notification) { $0.notificationType = "permission_prompt" }, at: t0 + 1)
        #expect(store.sessions[0].state == .approval)
        store.apply(event(.notification) { $0.notificationType = "idle_prompt" }, at: t0 + 2)
        #expect(store.sessions[0].state == .idle)
    }

    @Test func finishedTurnsIdle() {
        var store = SessionStore()
        store.apply(event(.stop), at: t0)
        store.tick(at: t0 + store.timing.finishedHold - 0.1)
        #expect(store.sessions[0].state == .finished)
        store.tick(at: t0 + store.timing.finishedHold)
        #expect(store.sessions[0].state == .idle)
    }

    @Test func quietSessionsSleepButAlertsDont() {
        var store = SessionStore()
        store.apply(event(.preToolUse, "a") { $0.toolName = "Bash" }, at: t0)
        store.apply(event(.permissionRequest, "b"), at: t0)
        store.tick(at: t0 + store.timing.sleepAfter)
        #expect(store.sessions.first { $0.id == "a" }?.state == .sleeping)
        #expect(store.sessions.first { $0.id == "b" }?.state == .approval)
    }

    @Test func staleSessionsAreForgotten() {
        var store = SessionStore()
        store.apply(event(.sessionStart), at: t0)
        store.tick(at: t0 + store.timing.forgetAfter)
        #expect(store.sessions.isEmpty)
    }

    @Test func nextDeadlineIsTheEarliestRule() {
        var store = SessionStore()
        store.apply(event(.stop), at: t0)
        #expect(store.nextDeadline(after: t0) == t0 + store.timing.finishedHold)
        store.tick(at: t0 + store.timing.finishedHold)
        #expect(store.nextDeadline(after: t0 + store.timing.finishedHold) == t0 + store.timing.sleepAfter)
        #expect(SessionStore().nextDeadline(after: t0) == nil)
    }

    @Test func focusPrefersTheLatestAlert() {
        var store = SessionStore()
        store.apply(event(.preToolUse, "busy") { $0.toolName = "Bash" }, at: t0 + 5)
        store.apply(event(.permissionRequest, "old-alert"), at: t0)
        store.apply(event(.permissionRequest, "new-alert"), at: t0 + 1)
        #expect(store.focused?.id == "new-alert")
    }

    @Test func focusThenPrefersBusySessions() {
        var store = SessionStore()
        store.apply(event(.preToolUse, "busy") { $0.toolName = "Bash" }, at: t0)
        store.apply(event(.sessionStart, "idle"), at: t0 + 5)
        #expect(store.focused?.id == "busy")
    }

    @Test func feedIsCapped() {
        var store = SessionStore()
        for i in 0..<(AgentSession.maxFeed + 5) {
            store.apply(event(.preToolUse) { $0.toolName = "Tool\(i)" }, at: t0 + Double(i))
        }
        #expect(store.sessions[0].feed.count == AgentSession.maxFeed)
        #expect(store.sessions[0].feed.last == "Tool\(AgentSession.maxFeed + 4)")
    }

    @Test func agentKeepsItsMote() {
        var store = SessionStore()
        store.apply(event(.sessionStart, agent: "gemini") { $0.cwd = nil }, at: t0)
        #expect(store.sessions[0].agent == "gemini")
        #expect(store.sessions[0].name == "Gemini")
    }
}
