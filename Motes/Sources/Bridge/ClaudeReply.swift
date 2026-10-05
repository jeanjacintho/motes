import Foundation

/// Decision JSON printed by `motes-hook` for Claude Code. Built in the app so
/// the hook stays a dumb relay.
enum ClaudeReply {
    enum Permission: Equatable {
        case allow
        case deny
        /// Allow, and remember the suggested rules in the project's local settings.
        case always
    }

    static let messageSource = "from Motes"

    /// Reply to a `PermissionRequest`.
    static func permission(_ choice: Permission, suggestions: Data?) -> Data? {
        var decision: [String: Any]
        switch choice {
        case .allow:
            decision = ["behavior": "allow"]
        case .deny:
            decision = ["behavior": "deny", "message": "Denied \(messageSource)."]
        case .always:
            decision = ["behavior": "allow"]
            if let updates = permissionUpdates(from: suggestions), !updates.isEmpty {
                decision["updatedPermissions"] = updates
                decision["message"] = "Always allowed \(messageSource)."
            }
        }
        return json(["hookSpecificOutput": ["hookEventName": "PermissionRequest", "decision": decision]])
    }

    /// Reply to the `PreToolUse` of `AskUserQuestion`: the original input plus
    /// `answers` (question text → label; several labels joined with ", ").
    static func answers(_ answers: [String: [String]], toolInput: Data) -> Data? {
        guard var input = (try? JSONSerialization.jsonObject(with: toolInput)) as? [String: Any] else { return nil }
        input["answers"] = answers.mapValues { $0.joined(separator: ", ") }
        return json(["hookSpecificOutput": [
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": input,
        ]])
    }

    /// Rules to remember for "Always allow". Suggestions come either as rule
    /// strings ("Bash(npm *)") or as ready-made permission updates.
    static func permissionUpdates(from suggestions: Data?) -> [[String: Any]]? {
        guard let suggestions,
              let array = (try? JSONSerialization.jsonObject(with: suggestions)) as? [Any] else { return nil }
        let rules = array.compactMap { $0 as? String }
        let updates = array.compactMap { $0 as? [String: Any] }
        var result = updates
        if !rules.isEmpty {
            result.insert(["type": "addRules", "destination": "local", "rules": rules], at: 0)
        }
        return result
    }

    /// Human summary of what "Always allow" will remember, for the button's tooltip.
    static func describe(suggestions: Data?) -> String? {
        guard let updates = permissionUpdates(from: suggestions), !updates.isEmpty else { return nil }
        let rules = updates.flatMap { update -> [String] in
            let raw = update["rules"] as? [Any] ?? []
            return raw.compactMap { rule in
                if let text = rule as? String { return text }
                guard let object = rule as? [String: Any], let tool = object["toolName"] as? String else { return nil }
                if let content = object["ruleContent"] as? String { return "\(tool)(\(content))" }
                return tool
            }
        }
        return rules.isEmpty ? nil : rules.joined(separator: ", ")
    }

    private static func json(_ object: [String: Any]) -> Data? {
        try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
}
