import Foundation

/// Decision JSON printed by `motes-hook` for Cursor's `beforeShellExecution`
/// and `beforeMCPExecution`. Cursor has no rules to remember, so "Always
/// allow" is a plain allow.
enum CursorReply {
    static func permission(_ choice: ClaudeReply.Permission) -> Data? {
        let object: [String: String] = switch choice {
        case .allow, .always:
            ["permission": "allow"]
        case .deny:
            ["permission": "deny", "user_message": "Denied \(ClaudeReply.messageSource).",
             "agent_message": "The user denied this command \(ClaudeReply.messageSource)."]
        }
        return try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
}

/// The permission reply in the format of the session's agent.
enum PermissionReply {
    static func make(_ choice: ClaudeReply.Permission, agent: String, suggestions: Data?) -> Data? {
        agent == CursorPayload.agent
            ? CursorReply.permission(choice)
            : ClaudeReply.permission(choice, suggestions: suggestions)
    }
}
