import Foundation
import Testing
@testable import Motes

struct BridgeProtocolTests {
    @Test(arguments: ["claude", "codex", "my-tool", "a", "agent-007", String(repeating: "a", count: 24)])
    func validAgentNames(_ name: String) {
        #expect(BridgeProtocol.isValidAgentName(name))
    }

    @Test(arguments: ["", "Claude", "my_tool", "my tool", "é", "../x", String(repeating: "a", count: 25)])
    func invalidAgentNames(_ name: String) {
        #expect(!BridgeProtocol.isValidAgentName(name))
    }

    func decode(_ data: Data?) throws -> [String: Any] {
        let data = try #require(data)
        #expect(data.last == 0x0A)
        return try #require(try JSONSerialization.jsonObject(with: data.dropLast()) as? [String: Any])
    }

    @Test func relayAddsAgentVersionAndTerminal() throws {
        let payload = Data(#"{"hook_event_name":"PreToolUse","session_id":"s1","tool_name":"Bash"}"#.utf8)
        let object = try decode(HookRelay.message(
            payload: payload, agent: "codex", eventName: nil,
            environment: ["TERM_PROGRAM": "iTerm.app", "ITERM_SESSION_ID": "w0t0p0", "HOME": "/Users/me", "API_KEY": "secret"]
        ))
        #expect(object["motes_agent"] as? String == "codex")
        #expect(object["v"] as? Int == 1)
        #expect(object["tool_name"] as? String == "Bash")
        let terminal = try #require(object["motes_terminal"] as? [String: String])
        #expect(terminal == ["TERM_PROGRAM": "iTerm.app", "ITERM_SESSION_ID": "w0t0p0"])
    }

    @Test func relayNeverCopiesOtherEnvironmentVariables() throws {
        let object = try decode(HookRelay.message(
            payload: Data(#"{"session_id":"s"}"#.utf8), agent: nil, eventName: "Stop",
            environment: ["AWS_SECRET_ACCESS_KEY": "x", "PATH": "/bin"]
        ))
        #expect(object["motes_terminal"] == nil)
        #expect(object["hook_event_name"] as? String == "Stop")
    }

    @Test func relayDropsInvalidAgent() throws {
        let object = try decode(HookRelay.message(
            payload: Data(#"{"session_id":"s"}"#.utf8), agent: "Bad Name", eventName: nil, environment: [:]
        ))
        #expect(object["motes_agent"] == nil)
    }

    @Test func relayKeepsTheEventNameFromThePayload() throws {
        let object = try decode(HookRelay.message(
            payload: Data(#"{"hook_event_name":"Stop","session_id":"s"}"#.utf8), agent: nil, eventName: "Other", environment: [:]
        ))
        #expect(object["hook_event_name"] as? String == "Stop")
    }

    @Test func relayRejectsNonObjects() {
        #expect(HookRelay.message(payload: Data("[1,2]".utf8), agent: nil, eventName: nil, environment: [:]) == nil)
        #expect(HookRelay.message(payload: Data("not json".utf8), agent: nil, eventName: nil, environment: [:]) == nil)
        #expect(HookRelay.message(payload: Data(), agent: nil, eventName: nil, environment: [:]) == nil)
    }

    @Test func relayRejectsOversizedPayloads() {
        let big = Data(("{\"x\":\"" + String(repeating: "a", count: BridgeProtocol.maxMessageBytes) + "\"}").utf8)
        #expect(HookRelay.message(payload: big, agent: nil, eventName: nil, environment: [:]) == nil)
    }
}
