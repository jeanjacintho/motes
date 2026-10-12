import Foundation
import Testing
@testable import Motes

struct CursorTests {
    let path = "/Users/me/Library/Application Support/Motes/bin/motes-hook"
    let start = Date(timeIntervalSince1970: 1_000)

    func event(_ object: [String: Any]) throws -> HookEvent {
        var object = object
        object["conversation_id"] = object["conversation_id"] ?? "c1"
        object["workspace_roots"] = object["workspace_roots"] ?? ["/code/app"]
        object["motes_agent"] = "cursor"
        return try #require(HookEvent.parse(try JSONSerialization.data(withJSONObject: object)))
    }

    // MARK: - Events

    @Test func cursorEventNamesMapToTheSameMoments() throws {
        #expect(try event(["hook_event_name": "sessionStart", "session_id": "c1"]).kind == .sessionStart)
        #expect(try event(["hook_event_name": "beforeSubmitPrompt", "prompt": "Fix it"]).kind == .userPromptSubmit)
        #expect(try event(["hook_event_name": "preToolUse", "tool_name": "Read"]).kind == .preToolUse)
        #expect(try event(["hook_event_name": "postToolUse", "tool_name": "Read"]).kind == .postToolUse)
        #expect(try event(["hook_event_name": "postToolUseFailure", "tool_name": "Read"]).kind == .postToolUseFailure)
        #expect(try event(["hook_event_name": "subagentStart"]).kind == .subagentStart)
        #expect(try event(["hook_event_name": "subagentStop"]).kind == .subagentStop)
        #expect(try event(["hook_event_name": "sessionEnd", "session_id": "c1"]).kind == .sessionEnd)
    }

    @Test func stopFollowsItsStatus() throws {
        #expect(try event(["hook_event_name": "stop", "status": "completed"]).kind == .stop)
        #expect(try event(["hook_event_name": "stop", "status": "error"]).kind == .stopFailure)
        #expect(try event(["hook_event_name": "stop", "status": "aborted"]).kind == .interrupt)
    }

    @Test func theConversationIsTheSessionAndTheWorkspaceItsFolder() throws {
        let prompt = try event(["hook_event_name": "beforeSubmitPrompt", "conversation_id": "abc", "prompt": "Hi"])
        #expect(prompt.sessionID == "abc")
        #expect(prompt.cwd == "/code/app")
        #expect(prompt.agent == "cursor")
        let tool = try event(["hook_event_name": "preToolUse", "tool_name": "Shell", "cwd": "/code/app/web"])
        #expect(tool.cwd == "/code/app/web")
    }

    @Test func otherAgentsKeepTheirSessionID() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "hook_event_name": "Stop", "session_id": "s1", "conversation_id": "other",
        ])
        #expect(try #require(HookEvent.parse(data)).sessionID == "s1")
    }

    @Test func aShellCommandIsAnApproval() throws {
        let shell = try event([
            "hook_event_name": "beforeShellExecution", "command": "npm test", "cwd": "/code/app",
            "motes_wait": BridgeProtocol.approvalWait,
        ])
        #expect(shell.kind == .permissionRequest)
        #expect(shell.toolName == "Shell")
        #expect(shell.toolInput["command"] == "npm test")

        let alert = try #require(PendingAlert.make(from: shell, id: UUID(), at: start))
        #expect(alert.agent == "cursor")
        guard case .approval(let approval) = alert.kind else { Issue.record("not an approval"); return }
        #expect(approval.summary == "Shell npm test")
        #expect(approval.detail == "npm test")
        #expect(approval.alwaysRule == nil)
    }

    @Test func anMCPToolIsAnApproval() throws {
        let mcp = try event([
            "hook_event_name": "beforeMCPExecution", "tool_name": "create_issue",
            "tool_input": "{\"title\":\"Bug\"}", "mcp_server_name": "github",
        ])
        #expect(mcp.kind == .permissionRequest)
        #expect(mcp.toolName == "MCP:create_issue")
        #expect(PendingAlert.make(from: mcp, id: UUID(), at: start) != nil)
    }

    @Test func aSessionFollowsCursor() throws {
        var store = SessionStore()
        store.apply(try event(["hook_event_name": "sessionStart", "session_id": "c1"]), at: start)
        store.apply(try event(["hook_event_name": "beforeSubmitPrompt", "prompt": "Fix the login"]), at: start)
        #expect(store.sessions.first?.state == .thinking)
        #expect(store.sessions.first?.name == "app")

        store.apply(try event(["hook_event_name": "preToolUse", "tool_name": "Shell",
                               "tool_input": ["command": "npm test", "working_directory": "/code/app"]]), at: start)
        #expect(store.sessions.first?.state == .working)
        #expect(store.sessions.first?.latestActivity == "Shell npm test")

        store.apply(try event(["hook_event_name": "beforeShellExecution", "command": "npm test"]), at: start)
        #expect(store.sessions.first?.state == .approval)

        store.apply(try event(["hook_event_name": "afterFileEdit", "file_path": "/code/app/Login.swift",
                               "edits": [["old_string": "a\nb\n", "new_string": "a\nc\n"]]]), at: start)
        #expect(store.sessions.first?.state == .working)
        #expect(store.sessions.first?.latestChange?.path == "/code/app/Login.swift")
        #expect(store.sessions.first?.latestChange?.added == 1)
        #expect(store.sessions.first?.latestChange?.removed == 1)

        store.apply(try event(["hook_event_name": "afterAgentResponse", "text": "## Done\nFixed the login."]), at: start)
        store.apply(try event(["hook_event_name": "stop", "status": "completed", "loop_count": 0]), at: start)
        #expect(store.sessions.first?.state == .finished)
        #expect(store.sessions.first?.latestActivity == "Done")

        store.apply(try event(["hook_event_name": "sessionEnd", "session_id": "c1", "reason": "user_close"]), at: start)
        #expect(store.sessions.isEmpty)
    }

    @Test func toolResultsAreNotDiffedTwice() throws {
        var store = SessionStore()
        store.apply(try event(["hook_event_name": "postToolUse", "tool_name": "Write",
                               "tool_input": ["file_path": "/code/app/New.swift"]]), at: start)
        #expect(store.sessions.first?.latestChange == nil)
    }

    // MARK: - Replies

    @Test func repliesUseCursorsPermissionFormat() throws {
        let allow = try #require(CursorReply.permission(.allow))
        #expect(try JSONSerialization.jsonObject(with: allow) as? [String: String] == ["permission": "allow"])
        let deny = try #require(CursorReply.permission(.deny))
        let object = try #require(try JSONSerialization.jsonObject(with: deny) as? [String: String])
        #expect(object["permission"] == "deny")
        #expect(object["user_message"] == "Denied from Motes.")
    }

    @Test func eachAgentGetsItsOwnReply() throws {
        let cursor = try #require(PermissionReply.make(.allow, agent: "cursor", suggestions: nil))
        #expect(try JSONSerialization.jsonObject(with: cursor) as? [String: String] == ["permission": "allow"])
        let claude = try #require(PermissionReply.make(.allow, agent: "claude", suggestions: nil))
        let object = try #require(try JSONSerialization.jsonObject(with: claude) as? [String: Any])
        #expect(object["hookSpecificOutput"] != nil)
    }

    // MARK: - Hook

    @Test func waitsOnlyForShellAndMCP() {
        #expect(HookRelay.waitTime(eventName: "beforeShellExecution", toolName: nil) == BridgeProtocol.approvalWait)
        #expect(HookRelay.waitTime(eventName: "beforeMCPExecution", toolName: "x") == BridgeProtocol.approvalWait)
        #expect(HookRelay.waitTime(eventName: "preToolUse", toolName: "Shell") == nil)
    }

    @Test func withoutAnAnswerCursorAsksAsUsual() throws {
        let ask = try #require(HookRelay.fallbackOutput(agent: "cursor", eventName: "beforeShellExecution"))
        #expect(try JSONSerialization.jsonObject(with: ask) as? [String: String] == ["permission": "ask"])
        #expect(HookRelay.fallbackOutput(agent: "cursor", eventName: "beforeMCPExecution") == ask)
        let empty = try #require(HookRelay.fallbackOutput(agent: "cursor", eventName: "preToolUse"))
        #expect((try JSONSerialization.jsonObject(with: empty) as? [String: Any])?.isEmpty == true)
        #expect(HookRelay.fallbackOutput(agent: nil, eventName: "PermissionRequest") == nil)
        #expect(HookRelay.fallbackOutput(agent: "codex", eventName: "PermissionRequest") == nil)
    }

    // MARK: - Settings

    @Test func hooksUseCursorsFlatLayout() throws {
        let settings = HookSettings.installing(into: [:], target: .cursor, hookPath: path)
        #expect(HookSettings.status(of: settings, target: .cursor, hookPath: path) == .installed)
        #expect(settings["version"] as? Int == 1)
        #expect(settings["statusLine"] == nil)
        let hooks = try #require(settings["hooks"] as? [String: Any])
        #expect(Set(hooks.keys) == [
            "sessionStart", "beforeSubmitPrompt", "preToolUse", "postToolUse", "postToolUseFailure",
            "beforeShellExecution", "beforeMCPExecution", "afterFileEdit", "afterAgentResponse",
            "stop", "subagentStop", "sessionEnd",
        ])
        let tool = try #require((hooks["preToolUse"] as? [[String: Any]])?.first)
        #expect(tool["command"] as? String == "\"\(path)\" --agent cursor")
        #expect(tool["timeout"] as? Int == 5)
        #expect(tool["hooks"] == nil)
        let shell = try #require((hooks["beforeShellExecution"] as? [[String: Any]])?.first)
        #expect(shell["command"] as? String == "\"\(path)\" --agent cursor --wait")
        #expect(shell["timeout"] as? Int == Int(BridgeProtocol.approvalWait) + 10)
    }

    @Test func installKeepsTheUsersHooksAndVersion() throws {
        let user: [String: Any] = ["version": 2, "hooks": ["stop": [["command": "./audit.sh", "loop_limit": 10]]]]
        let settings = HookSettings.installing(into: user, target: .cursor, hookPath: path)
        #expect(settings["version"] as? Int == 2)
        let stop = try #require((settings["hooks"] as? [String: Any])?["stop"] as? [[String: Any]])
        #expect(stop.count == 2)
        #expect(stop.first?["command"] as? String == "./audit.sh")

        let removed = HookSettings.removing(from: settings)
        #expect(NSDictionary(dictionary: removed).isEqual(to: user))
    }

    @Test func aChangedEntryIsOutdated() throws {
        var settings = HookSettings.installing(into: [:], target: .cursor, hookPath: path)
        var hooks = try #require(settings["hooks"] as? [String: Any])
        hooks["stop"] = nil
        settings["hooks"] = hooks
        #expect(HookSettings.status(of: settings, target: .cursor, hookPath: path) == .outdated)
        #expect(HookSettings.status(of: ["version": 1], target: .cursor, hookPath: path) == .notInstalled)
    }
}
