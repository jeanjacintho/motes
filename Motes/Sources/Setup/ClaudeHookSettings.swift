import Foundation

/// Adds and removes Motes' entries in Claude Code's settings.json.
/// Pure: works on the decoded JSON object, never on files. Entries that aren't
/// Motes' own are never touched.
enum ClaudeHookSettings {
    /// Hook events Motes listens to, with their matcher (tool events match every tool).
    static let events: [(name: String, matcher: String?)] = [
        ("SessionStart", nil),
        ("UserPromptSubmit", nil),
        ("PreToolUse", "*"),
        ("PostToolUse", "*"),
        ("PermissionRequest", "*"),
        ("Notification", nil),
        ("Stop", nil),
        ("SubagentStop", nil),
        ("SessionEnd", nil),
    ]

    /// Seconds Claude Code waits for the hook. The hook itself gives up after 0.3 s.
    static let timeout = 5
    /// Any hook command containing this is considered Motes'.
    static let marker = "motes-hook"

    enum Status: Equatable {
        case notInstalled
        case installed
        /// Some Motes entries exist but don't match the current hook path or event list.
        case outdated
    }

    static func command(hookPath: String) -> String {
        "\"\(hookPath)\""
    }

    static func status(of settings: [String: Any], hookPath: String) -> Status {
        let expected = command(hookPath: hookPath)
        let hooks = settings["hooks"] as? [String: Any] ?? [:]
        var found = 0
        var foreign = false
        for (event, value) in hooks {
            for command in commands(in: value) where command.contains(marker) {
                if command == expected, events.contains(where: { $0.name == event }) {
                    found += 1
                } else {
                    foreign = true
                }
            }
        }
        if found == 0 && !foreign { return .notInstalled }
        return found == events.count && !foreign ? .installed : .outdated
    }

    /// Settings with Motes' hooks, replacing any previous Motes entries.
    static func installing(into settings: [String: Any], hookPath: String) -> [String: Any] {
        var result = removing(from: settings)
        var hooks = result["hooks"] as? [String: Any] ?? [:]
        for (event, matcher) in events {
            var groups = hooks[event] as? [Any] ?? []
            var group: [String: Any] = [
                "hooks": [["type": "command", "command": command(hookPath: hookPath), "timeout": timeout]],
            ]
            if let matcher { group["matcher"] = matcher }
            groups.append(group)
            hooks[event] = groups
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

    private static func commands(in value: Any) -> [String] {
        guard let groups = value as? [Any] else { return [] }
        return groups.flatMap { group -> [String] in
            let entries = (group as? [String: Any])?["hooks"] as? [Any] ?? []
            return entries.compactMap { ($0 as? [String: Any])?["command"] as? String }
        }
    }
}
