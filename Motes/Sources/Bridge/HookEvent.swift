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
        case other(String)

        init(name: String) {
            switch name {
            case "SessionStart": self = .sessionStart
            case "SessionEnd": self = .sessionEnd
            case "UserPromptSubmit": self = .userPromptSubmit
            case "PreToolUse": self = .preToolUse
            case "PostToolUse": self = .postToolUse
            case "PostToolUseFailure": self = .postToolUseFailure
            case "PermissionRequest": self = .permissionRequest
            case "Notification": self = .notification
            case "Stop": self = .stop
            case "StopFailure": self = .stopFailure
            case "SubagentStart": self = .subagentStart
            case "SubagentStop": self = .subagentStop
            default: self = .other(name)
            }
        }
    }

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
    var message: String?
    var notificationType: String?
    var lastAssistantMessage: String?
    var terminal: [String: String] = [:]

    static func parse(_ data: Data) -> HookEvent? {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let name = object[BridgeProtocol.Key.eventName] as? String,
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
        }
        event.message = nonEmpty(object["message"])
        event.notificationType = nonEmpty(object["notification_type"])
        event.lastAssistantMessage = nonEmpty(object["last_assistant_message"])
        event.terminal = (object[BridgeProtocol.Key.terminal] as? [String: String]) ?? [:]
        return event
    }

    private static func nonEmpty(_ value: Any?) -> String? {
        guard let string = value as? String, !string.isEmpty else { return nil }
        return string
    }
}
