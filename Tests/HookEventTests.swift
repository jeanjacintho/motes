import Foundation
import Testing
@testable import Motes

struct HookEventTests {
    func parse(_ json: String) -> HookEvent? { HookEvent.parse(Data(json.utf8)) }

    @Test func parsesAToolEvent() throws {
        let event = try #require(parse("""
        {"hook_event_name":"PreToolUse","session_id":"abc","cwd":"/Users/me/code/app",
         "tool_name":"Edit","tool_input":{"file_path":"/Users/me/code/app/Main.swift","old_string":"a","replace_all":false},
         "motes_agent":"codex","motes_terminal":{"TERM_PROGRAM":"Apple_Terminal"}}
        """))
        #expect(event.kind == .preToolUse)
        #expect(event.sessionID == "abc")
        #expect(event.agent == "codex")
        #expect(event.cwd == "/Users/me/code/app")
        #expect(event.toolName == "Edit")
        #expect(event.toolInput == ["file_path": "/Users/me/code/app/Main.swift", "old_string": "a"])
        #expect(event.terminal == ["TERM_PROGRAM": "Apple_Terminal"])
    }

    @Test func defaultsToClaude() throws {
        #expect(try #require(parse(#"{"hook_event_name":"Stop","session_id":"a"}"#)).agent == "claude")
        #expect(try #require(parse(#"{"hook_event_name":"Stop","session_id":"a","motes_agent":"NOPE!"}"#)).agent == "claude")
    }

    @Test func unknownEventsAreKept() throws {
        #expect(try #require(parse(#"{"hook_event_name":"PreCompact","session_id":"a"}"#)).kind == .other("PreCompact"))
    }

    @Test func requiresEventAndSession() {
        #expect(parse(#"{"session_id":"a"}"#) == nil)
        #expect(parse(#"{"hook_event_name":"Stop"}"#) == nil)
        #expect(parse(#"{"hook_event_name":"Stop","session_id":""}"#) == nil)
        #expect(parse("garbage") == nil)
    }
}
