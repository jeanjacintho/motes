import Foundation

/// Adds and removes Motes' entries in Claude Code's settings.json.
/// Pure: works on the decoded JSON object, never on files. Entries that aren't
/// Motes' own are never touched.
enum ClaudeHookSettings {
    /// One hook entry Motes adds to Claude Code's settings.
    struct Entry: Equatable {
        let event: String
        /// Tool matcher for tool events, `nil` for the others.
        let matcher: String?
        /// Waits for an answer from the notch (permission, question).
        let waits: Bool
        /// Seconds Claude Code waits for the hook.
        let timeout: Int
    }

    /// Everything Motes registers. Listening hooks give up after 0.3 s; waiting
    /// hooks get a timeout just above the time they wait for the user.
    static let entries: [Entry] = [
        Entry(event: "SessionStart", matcher: nil, waits: false, timeout: 5),
        Entry(event: "UserPromptSubmit", matcher: nil, waits: false, timeout: 5),
        Entry(event: "PreToolUse", matcher: "*", waits: false, timeout: 5),
        Entry(event: "PreToolUse", matcher: "AskUserQuestion", waits: true,
              timeout: Int(BridgeProtocol.questionWait) + 10),
        Entry(event: "PostToolUse", matcher: "*", waits: false, timeout: 5),
        Entry(event: "PermissionRequest", matcher: "*", waits: true,
              timeout: Int(BridgeProtocol.approvalWait) + 10),
        Entry(event: "Notification", matcher: nil, waits: false, timeout: 5),
        Entry(event: "Stop", matcher: nil, waits: false, timeout: 5),
        Entry(event: "SubagentStop", matcher: nil, waits: false, timeout: 5),
        Entry(event: "SessionEnd", matcher: nil, waits: false, timeout: 5),
    ]

    /// Any hook command containing this is considered Motes'.
    static let marker = "motes-hook"

    enum Status: Equatable {
        case notInstalled
        case installed
        /// Some Motes entries exist but don't match the current hook path or entry list.
        case outdated
    }

    static func command(hookPath: String, waits: Bool = false) -> String {
        "\"\(hookPath)\"" + (waits ? " --wait" : "")
    }

    static func status(of settings: [String: Any], hookPath: String) -> Status {
        let hooks = settings["hooks"] as? [String: Any] ?? [:]
        // Every Motes entry found, as (event, matcher, command, timeout).
        var found: [(String, String?, String, Int?)] = []
        for (event, value) in hooks {
            guard let groups = value as? [Any] else { continue }
            for case let group as [String: Any] in groups {
                let matcher = group["matcher"] as? String
                for case let entry as [String: Any] in group["hooks"] as? [Any] ?? [] {
                    guard let command = entry["command"] as? String, command.contains(marker) else { continue }
                    found.append((event, matcher, command, entry["timeout"] as? Int))
                }
            }
        }
        if found.isEmpty { return .notInstalled }
        let expected = entries.map { ($0.event, $0.matcher, command(hookPath: hookPath, waits: $0.waits), $0.timeout) }
        let matches = found.count == expected.count && expected.allSatisfy { e in
            found.contains { $0.0 == e.0 && $0.1 == e.1 && $0.2 == e.2 && $0.3 == e.3 }
        }
        return matches ? .installed : .outdated
    }

    /// Settings with Motes' hooks, replacing any previous Motes entries.
    static func installing(into settings: [String: Any], hookPath: String) -> [String: Any] {
        var result = removing(from: settings)
        var hooks = result["hooks"] as? [String: Any] ?? [:]
        for entry in entries {
            var groups = hooks[entry.event] as? [Any] ?? []
            var group: [String: Any] = [
                "hooks": [[
                    "type": "command",
                    "command": command(hookPath: hookPath, waits: entry.waits),
                    "timeout": entry.timeout,
                ]],
            ]
            if let matcher = entry.matcher { group["matcher"] = matcher }
            groups.append(group)
            hooks[entry.event] = groups
        }
        result["hooks"] = hooks
        return result
    }

    /// Settings without any Motes entry. Groups, events and the `hooks` key are
    /// dropped only when Motes' removal leaves them empty.
    static func removing(from settings: [String: Any]) -> [String: Any] {
        guard var hooks = settings["hooks"] as? [String: Any] else { return settings }
        var result = settings
        for (event, value) in hooks {
            guard let groups = value as? [Any] else { continue }
            var kept: [Any] = []
            for case let group as [String: Any] in groups {
                guard let entries = group["hooks"] as? [Any] else { kept.append(group); continue }
                let remaining = entries.filter { entry in
                    !((entry as? [String: Any])?["command"] as? String ?? "").contains(marker)
                }
                if remaining.count == entries.count {
                    kept.append(group)
                } else if !remaining.isEmpty {
                    var trimmed = group
                    trimmed["hooks"] = remaining
                    kept.append(trimmed)
                }
            }
            // Keep anything in the array that isn't a dictionary, untouched.
            kept.append(contentsOf: groups.filter { !($0 is [String: Any]) })
            hooks[event] = kept.isEmpty ? nil : kept
        }
        result["hooks"] = hooks.isEmpty ? nil : hooks
        return result
    }
}
