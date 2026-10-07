import Foundation
import Testing
@testable import Motes

struct GeminiTests {
    let path = "/Users/me/Library/Application Support/Motes/bin/motes-hook"
    let start = Date(timeIntervalSince1970: 1_000)

    func event(_ object: [String: Any]) throws -> HookEvent {
        var object = object
        object["session_id"] = object["session_id"] ?? "g1"
        object["motes_agent"] = "gemini"
        object["cwd"] = "/code/app"
        return try #require(HookEvent.parse(try JSONSerialization.data(withJSONObject: object)))
    }

    @Test func geminiEventNamesMapToTheSameMoments() throws {
        #expect(try event(["hook_event_name": "BeforeAgent", "prompt": "Fix it"]).kind == .userPromptSubmit)
        #expect(try event(["hook_event_name": "BeforeTool"]).kind == .preToolUse)
        #expect(try event(["hook_event_name": "AfterTool"]).kind == .postToolUse)
        let after = try event(["hook_event_name": "AfterAgent", "prompt_response": "## Done\nAll good"])
        #expect(after.kind == .stop)
        #expect(after.lastAssistantMessage == "## Done\nAll good")
        #expect(after.agent == "gemini")
    }

    @Test func aSessionFollowsGemini() throws {
        var store = SessionStore()
        store.apply(try event(["hook_event_name": "SessionStart", "source": "startup"]), at: start)
        store.apply(try event(["hook_event_name": "BeforeAgent", "prompt": "Fix the login"]), at: start)
        #expect(store.sessions.first?.state == .thinking)

        store.apply(try event(["hook_event_name": "BeforeTool", "tool_name": "run_shell_command",
                               "tool_input": ["command": "npm test"]]), at: start)
        #expect(store.sessions.first?.state == .working)
        #expect(store.sessions.first?.latestActivity == "Bash npm test")

        store.apply(try event(["hook_event_name": "Notification", "notification_type": "ToolPermission",
                               "message": "Allow run_shell_command?", "details": [:]]), at: start)
        #expect(store.sessions.first?.state == .approval)

        store.apply(try event(["hook_event_name": "AfterTool", "tool_name": "replace", "tool_input": [
            "file_path": "/code/app/Login.swift", "old_string": "a\nb\n", "new_string": "a\nc\n",
        ]]), at: start)
        #expect(store.sessions.first?.latestChange?.added == 1)
        #expect(store.sessions.first?.latestChange?.removed == 1)

        store.apply(try event(["hook_event_name": "AfterAgent", "prompt_response": "Fixed the login."]), at: start)
        #expect(store.sessions.first?.state == .finished)
        #expect(store.sessions.first?.latestActivity == "Fixed the login.")

        store.apply(try event(["hook_event_name": "SessionEnd", "reason": "exit"]), at: start)
        #expect(store.sessions.isEmpty)
    }

    @Test func askUserIsAQuestionWithoutACard() throws {
        var store = SessionStore()
        let ask = try event(["hook_event_name": "BeforeTool", "tool_name": "ask_user", "tool_input": ["questions": []]])
        store.apply(ask, at: start)
        #expect(store.sessions.first?.state == .question)
        #expect(PendingAlert.make(from: ask, id: UUID(), at: start) == nil)
    }

    @Test(arguments: [
        ("replace", ["file_path": "/a/Login.swift"], "Edit Login.swift"),
        ("write_file", ["file_path": "/a/New.swift"], "Write New.swift"),
        ("read_file", ["file_path": "/a/Old.swift"], "Read Old.swift"),
        ("grep_search", ["pattern": "TODO"], "Grep \"TODO\""),
        ("glob", ["pattern": "**/*.swift"], "Glob **/*.swift"),
        ("list_directory", ["dir_path": "/a/Sources"], "List Sources"),
        ("google_web_search", ["query": "swift testing"], "WebSearch swift testing"),
    ])
    func geminiToolLabels(tool: String, input: [String: String], label: String) {
        #expect(ActivityLabel.tool(tool, input: input) == label)
    }

    @Test func writesAreDiffed() throws {
        let input = try JSONSerialization.data(withJSONObject: ["file_path": "/a/New.swift", "content": "one\ntwo\n"])
        let change = try #require(DiffEngine.changes(tool: "write_file", input: input, at: start).first)
        #expect(change.added == 2 && change.removed == 0)
    }

    @Test func hooksUseMillisecondsAndGeminiNames() throws {
        let settings = HookSettings.installing(into: ["general": ["vimMode": true]], target: .gemini, hookPath: path)
        #expect(HookSettings.status(of: settings, target: .gemini, hookPath: path) == .installed)
        #expect(settings["statusLine"] == nil)
        let hooks = try #require(settings["hooks"] as? [String: Any])
        #expect(Set(hooks.keys) == ["SessionStart", "BeforeAgent", "BeforeTool", "AfterTool", "Notification", "AfterAgent", "SessionEnd"])
        let tool = try #require((hooks["BeforeTool"] as? [[String: Any]])?.first)
        #expect(tool["matcher"] as? String == "*")
        let entry = try #require((tool["hooks"] as? [[String: Any]])?.first)
        #expect(entry["command"] as? String == "\"\(path)\" --agent gemini")
        #expect(entry["timeout"] as? Int == 5_000)

        let removed = HookSettings.removing(from: settings)
        #expect(NSDictionary(dictionary: removed).isEqual(to: ["general": ["vimMode": true]]))
    }

    @Test func geminiMotesHaveHooks() {
        #expect(MoteCLI.gemini.hasHookSupport)
    }
}
