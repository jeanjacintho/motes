import Foundation
import Testing
@testable import Motes

struct ClaudeReplyTests {
    func object(_ data: Data?) throws -> [String: Any] {
        let data = try #require(data)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func decision(_ data: Data?) throws -> [String: Any] {
        let reply = try object(data)
        let output = try #require(reply["hookSpecificOutput"] as? [String: Any])
        #expect(output["hookEventName"] as? String == "PermissionRequest")
        return try #require(output["decision"] as? [String: Any])
    }

    @Test func allow() throws {
        let d = try decision(ClaudeReply.permission(.allow, suggestions: nil))
        #expect(d["behavior"] as? String == "allow")
        #expect(d["updatedPermissions"] == nil)
    }

    @Test func deny() throws {
        let d = try decision(ClaudeReply.permission(.deny, suggestions: nil))
        #expect(d["behavior"] as? String == "deny")
        #expect(d["message"] as? String != nil)
    }

    @Test func alwaysWithRuleStringsAddsLocalRules() throws {
        let suggestions = try JSONSerialization.data(withJSONObject: ["Bash(npm *)"])
        let d = try decision(ClaudeReply.permission(.always, suggestions: suggestions))
        #expect(d["behavior"] as? String == "allow")
        let updates = try #require(d["updatedPermissions"] as? [[String: Any]])
        #expect(updates.count == 1)
        #expect(updates[0]["type"] as? String == "addRules")
        #expect(updates[0]["destination"] as? String == "local")
        #expect(updates[0]["rules"] as? [String] == ["Bash(npm *)"])
    }

    @Test func alwaysPassesPermissionUpdatesThrough() throws {
        let update: [String: Any] = ["type": "addRules", "destination": "session",
                                     "rules": [["toolName": "Bash", "ruleContent": "npm test"]], "behavior": "allow"]
        let suggestions = try JSONSerialization.data(withJSONObject: [update])
        let d = try decision(ClaudeReply.permission(.always, suggestions: suggestions))
        let updates = try #require(d["updatedPermissions"] as? [[String: Any]])
        #expect(NSDictionary(dictionary: updates[0]).isEqual(to: update))
        #expect(ClaudeReply.describe(suggestions: suggestions) == "Bash(npm test)")
    }

    @Test func alwaysWithoutSuggestionsIsAPlainAllow() throws {
        let d = try decision(ClaudeReply.permission(.always, suggestions: nil))
        #expect(d["behavior"] as? String == "allow")
        #expect(d["updatedPermissions"] == nil)
        #expect(ClaudeReply.describe(suggestions: nil) == nil)
    }

    @Test func answersEchoTheQuestions() throws {
        let input = try JSONSerialization.data(withJSONObject: ["questions": [["question": "Which?", "options": []]]])
        let reply = try object(ClaudeReply.answers(["Which?": ["A", "B"]], toolInput: input))
        let output = try #require(reply["hookSpecificOutput"] as? [String: Any])
        #expect(output["hookEventName"] as? String == "PreToolUse")
        #expect(output["permissionDecision"] as? String == "allow")
        let updated = try #require(output["updatedInput"] as? [String: Any])
        #expect((updated["questions"] as? [Any])?.count == 1)
        #expect(updated["answers"] as? [String: String] == ["Which?": "A, B"])
    }
}

struct AskQuestionTests {
    func data(_ object: Any) -> Data { try! JSONSerialization.data(withJSONObject: object) }

    func question(_ text: String, options: [String], multi: Bool = false) -> [String: Any] {
        ["question": text, "header": "Pick", "multiSelect": multi,
         "options": options.map { ["label": $0, "description": "about \($0)"] }]
    }

    @Test func parses() throws {
        let q = try #require(AskQuestion.parse(data(["questions": [
            question("Which database?", options: ["Postgres", "SQLite"]),
            question("Extras?", options: ["Cache", "Queue", "Search"], multi: true),
        ]])))
        #expect(q.items.count == 2)
        #expect(q.items[0].options.map(\.label) == ["Postgres", "SQLite"])
        #expect(q.items[0].options[0].description == "about Postgres")
        #expect(q.items[1].multiSelect)
    }

    @Test func rejectsWhatItCantShow() {
        #expect(AskQuestion.parse(data(["questions": []])) == nil)
        #expect(AskQuestion.parse(data(["questions": Array(repeating: question("Q", options: ["a", "b"]), count: 5)])) == nil)
        #expect(AskQuestion.parse(data(["questions": [question("Q", options: ["only one"])]])) == nil)
        #expect(AskQuestion.parse(data(["questions": [question("Same", options: ["a", "b"]), question("Same", options: ["c", "d"])]])) == nil)
        #expect(AskQuestion.parse(data(["nope": 1])) == nil)
    }
}

struct AlertQueueTests {
    let now = Date(timeIntervalSinceReferenceDate: 0)

    func approval(_ session: String = "s1", wait: TimeInterval = 110) -> PendingAlert {
        var event = HookEvent(kind: .permissionRequest, sessionID: session, agent: "claude")
        event.toolName = "Bash"
        event.toolInput = ["command": "rm -rf build"]
        event.wait = wait
        return PendingAlert.approval(from: event, id: UUID(), at: now)!
    }

    @Test func approvalShowsTheCommand() throws {
        guard case .approval(let a) = approval().kind else { Issue.record("not an approval"); return }
        #expect(a.toolName == "Bash")
        #expect(a.detail == "rm -rf build")
        #expect(a.alwaysRule == nil)
    }

    @Test func questionNeedsAskUserQuestion() {
        var event = HookEvent(kind: .preToolUse, sessionID: "s", agent: "claude")
        event.toolName = "Bash"
        event.rawToolInput = Data("{}".utf8)
        #expect(PendingAlert.question(from: event, id: UUID(), at: now) == nil)
        #expect(PendingAlert.approval(from: event, id: UUID(), at: now) == nil)
    }

    @Test func firstInFirstOut() {
        var queue = AlertQueue()
        let a = approval("a"), b = approval("b")
        queue.add(a); queue.add(b)
        #expect(queue.current?.id == a.id)
        queue.remove(id: a.id)
        #expect(queue.current?.id == b.id)
    }

    @Test func turnEndingDropsTheSessionsAlerts() {
        var queue = AlertQueue()
        queue.add(approval("a")); queue.add(approval("b"))
        #expect(queue.obsoleted(by: HookEvent(kind: .preToolUse, sessionID: "a", agent: "claude")).isEmpty)
        #expect(queue.obsoleted(by: HookEvent(kind: .notification, sessionID: "a", agent: "claude")).isEmpty)
        let gone = queue.obsoleted(by: HookEvent(kind: .stop, sessionID: "a", agent: "claude"))
        #expect(gone.map(\.sessionID) == ["a"])
        #expect(queue.alerts.map(\.sessionID) == ["b"])
    }

    @Test func expiry() {
        var queue = AlertQueue()
        queue.add(approval(wait: 10)); queue.add(approval(wait: 100))
        #expect(queue.nextExpiry == now + 10)
        #expect(queue.expired(at: now + 9).isEmpty)
        #expect(queue.expired(at: now + 10).count == 1)
        #expect(queue.alerts.count == 1)
    }
}

struct HookWaitTests {
    @Test func onlyAnswerableEventsWait() {
        #expect(HookRelay.waitTime(eventName: "PermissionRequest", toolName: "Bash") == BridgeProtocol.approvalWait)
        #expect(HookRelay.waitTime(eventName: "PreToolUse", toolName: "AskUserQuestion") == BridgeProtocol.questionWait)
        #expect(HookRelay.waitTime(eventName: "PreToolUse", toolName: "Bash") == nil)
        #expect(HookRelay.waitTime(eventName: "Stop", toolName: nil) == nil)
        #expect(HookRelay.waitTime(eventName: nil, toolName: nil) == nil)
    }

    @Test func hookPrintsOnlyJSONObjects() {
        #expect(HookRelay.output(fromReply: Data(#"{"a":1}"#.utf8)) != nil)
        #expect(HookRelay.output(fromReply: nil) == nil)
        #expect(HookRelay.output(fromReply: Data()) == nil)
        #expect(HookRelay.output(fromReply: Data("garbage".utf8)) == nil)
        #expect(HookRelay.output(fromReply: Data("[1]".utf8)) == nil)
    }
}
