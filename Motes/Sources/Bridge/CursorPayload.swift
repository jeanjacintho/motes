import Foundation

/// Rewrites a Cursor hook payload into the fields Claude Code uses, so the
/// rest of Motes reads every agent the same way. Pure.
///
/// Cursor names a session by `conversation_id`, gives the folder in `cwd` or
/// `workspace_roots`, asks about each shell command and MCP tool in their own
/// events, and reports file edits after the fact in `afterFileEdit`.
enum CursorPayload {
    static let agent = "cursor"

    static func canonical(_ payload: [String: Any]) -> [String: Any] {
        var object = payload
        if object["session_id"] == nil, let conversation = object["conversation_id"] {
            object["session_id"] = conversation
        }
        if object["cwd"] == nil, let root = (object["workspace_roots"] as? [Any])?.first as? String {
            object["cwd"] = root
        }
        guard let name = object[BridgeProtocol.Key.eventName] as? String else { return object }
        if let canonical = eventNames[name] { object[BridgeProtocol.Key.eventName] = canonical }

        switch name {
        case "beforeShellExecution":
            object["tool_name"] = "Shell"
            if let command = object["command"] as? String { object["tool_input"] = ["command": command] }
        case "beforeMCPExecution":
            if let tool = object["tool_name"] as? String, !tool.hasPrefix("MCP:") {
                object["tool_name"] = "MCP:" + tool
            }
            // Cursor sends the MCP arguments as a JSON string: keep them out of the card.
            if !(object["tool_input"] is [String: Any]) { object["tool_input"] = nil }
        case "postToolUse":
            // Edits are diffed from `afterFileEdit`, which carries the old and new text.
            object["tool_input"] = nil
        case "afterFileEdit":
            object["tool_name"] = "MultiEdit"
            object["tool_input"] = ["file_path": object["file_path"] ?? "", "edits": object["edits"] ?? []]
        case "afterAgentResponse":
            object["last_assistant_message"] = object["text"]
        case "stop":
            switch object["status"] as? String {
            case "error": object[BridgeProtocol.Key.eventName] = "StopFailure"
            case "aborted": object[BridgeProtocol.Key.eventName] = "Interrupt"
            default: break
            }
        default:
            break
        }
        return object
    }

    /// Cursor's event names and the Claude Code moments they match.
    static let eventNames: [String: String] = [
        "sessionStart": "SessionStart",
        "sessionEnd": "SessionEnd",
        "beforeSubmitPrompt": "UserPromptSubmit",
        "preToolUse": "PreToolUse",
        "postToolUse": "PostToolUse",
        "postToolUseFailure": "PostToolUseFailure",
        "beforeShellExecution": "PermissionRequest",
        "beforeMCPExecution": "PermissionRequest",
        "afterFileEdit": "PostToolUse",
        "afterAgentResponse": HookEvent.agentResponseName,
        "stop": "Stop",
        "subagentStart": "SubagentStart",
        "subagentStop": "SubagentStop",
    ]
}
