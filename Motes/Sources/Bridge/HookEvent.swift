import Foundation

/// A hook event as sent by `motes-hook`. Only the fields Motes uses are kept.
struct HookEvent: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case sessionStart, sessionEnd
        case userPromptSubmit
        case preToolUse, postToolUse, postToolUseFailure
        case permissionRequest
        case notification
        case stop, stopFailure
        case subagentStart, subagentStop
        /// The user stopped the agent mid-turn (Codex).
        case interrupt
        /// The agent's reply, sent apart from the end of its turn (Cursor).
        case agentResponse
        /// Claude Code's status line: plan usage only, not a session event.
        case statusLine
        case other(String)

        /// Claude Code and Codex names, and Gemini CLI's own names for the same moments.
        init(name: String) {
            switch name {
            case "SessionStart": self = .sessionStart
            case "SessionEnd": self = .sessionEnd
            case "UserPromptSubmit", "BeforeAgent": self = .userPromptSubmit
            case "PreToolUse", "BeforeTool": self = .preToolUse
            case "PostToolUse", "AfterTool": self = .postToolUse
            case "PostToolUseFailure": self = .postToolUseFailure
            case "PermissionRequest": self = .permissionRequest
            case "Notification": self = .notification
            case "Stop", "AfterAgent": self = .stop
            case "StopFailure": self = .stopFailure
            case "SubagentStart": self = .subagentStart
            case "SubagentStop": self = .subagentStop
            case "Interrupt": self = .interrupt
            case HookEvent.agentResponseName: self = .agentResponse
            case StatusLineRelay.eventName: self = .statusLine
            default: self = .other(name)
            }
        }
    }

    /// Canonical name of `.agentResponse`; no agent sends it as is.
    static let agentResponseName = "AgentResponse"

    var kind: Kind
    var sessionID: String
    /// Validated agent name; `BridgeProtocol.defaultAgent` when absent or invalid.
    var agent: String
    /// Mote the session belongs to, when it runs in a terminal Motes opened.
    var moteID: String?
    var cwd: String?
    var prompt: String?
    var toolName: String?
    /// String fields of `tool_input` (file_path, command, pattern…).
    var toolInput: [String: String] = [:]
    /// `tool_input` as sent, to echo it back when answering.
    var rawToolInput: Data?
    /// `permission_suggestions` as sent (rule strings or permission updates).
    var permissionSuggestions: Data?
    /// Seconds the hook waits for an answer; `nil` when it doesn't wait.
    var wait: TimeInterval?
    var message: String?
    var notificationType: String?
    var lastAssistantMessage: String?
    var terminal: [String: String] = [:]
    /// Plan usage, on status line events.
    var usage: PlanUsage?

    static func parse(_ data: Data) -> HookEvent? {
        guard var object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        if object[BridgeProtocol.Key.agent] as? String == CursorPayload.agent {
            object = CursorPayload.canonical(object)
        }
        guard let name = object[BridgeProtocol.Key.eventName] as? String,
              let sessionID = object["session_id"] as? String, !sessionID.isEmpty
        else { return nil }

        let agent = (object[BridgeProtocol.Key.agent] as? String)
            .flatMap { BridgeProtocol.isValidAgentName($0) ? $0 : nil } ?? BridgeProtocol.defaultAgent

        var event = HookEvent(kind: Kind(name: name), sessionID: sessionID, agent: agent)
        event.moteID = (object[BridgeProtocol.Key.mote] as? String).flatMap { BridgeProtocol.isValidMoteID($0) ? $0 : nil }
        event.cwd = nonEmpty(object["cwd"])
        event.prompt = nonEmpty(object["prompt"])
        event.toolName = nonEmpty(object["tool_name"])
        if let input = object["tool_input"] as? [String: Any] {
            event.toolInput = input.compactMapValues { $0 as? String }
            event.rawToolInput = try? JSONSerialization.data(withJSONObject: input)
        }
        if let suggestions = object["permission_suggestions"] as? [Any], !suggestions.isEmpty {
            event.permissionSuggestions = try? JSONSerialization.data(withJSONObject: suggestions)
        }
        event.wait = (object[BridgeProtocol.Key.wait] as? Double).flatMap { $0 > 0 ? $0 : nil }
        event.message = nonEmpty(object["message"])
        event.notificationType = nonEmpty(object["notification_type"])
        // Gemini CLI sends the reply as `prompt_response`.
        event.lastAssistantMessage = nonEmpty(object["last_assistant_message"]) ?? nonEmpty(object["prompt_response"])
        event.terminal = (object[BridgeProtocol.Key.terminal] as? [String: String]) ?? [:]
        if event.kind == .statusLine { event.usage = PlanUsage.parse(object["rate_limits"]) }
        return event
    }

    private static func nonEmpty(_ value: Any?) -> String? {
        guard let string = value as? String, !string.isEmpty else { return nil }
        return string
    }
}
