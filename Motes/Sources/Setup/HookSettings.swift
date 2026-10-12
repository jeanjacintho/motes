import Foundation

/// An agent whose hooks Motes can install, and what it registers there.
struct HookTarget: Equatable, Identifiable {
    let id: String
    /// Shown in Settings.
    let name: String
    /// Passed to the hook as `--agent`; `nil` for Claude Code, the default agent.
    let agent: String?
    /// Settings file, relative to the home folder.
    let settingsPath: String
    let entries: [HookSettings.Entry]
    /// Shown under the install button: what the user still has to do.
    let footer: String
    /// `timeout` unit in the settings file: 1 for seconds, 1000 for milliseconds (Gemini CLI).
    var timeoutScale = 1
    /// Also wraps the agent's status line to read the plan usage (Claude Code).
    var wrapsStatusLine = false
    var layout = HookSettings.Layout.grouped

    var settingsURL: URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(settingsPath)
    }

    typealias Entry = HookSettings.Entry

    static let claude = HookTarget(
        id: "claude", name: "Claude Code", agent: nil, settingsPath: ".claude/settings.json",
        entries: [
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
        ],
        footer: "It also runs before your status line to read your plan usage; your status line shows as before. If Motes isn't running, Claude Code carries on as usual.",
        wrapsStatusLine: true
    )

    /// Codex reads `~/.codex/hooks.json` (same layout as Claude Code). Tool
    /// groups have no matcher: Codex matches every tool then. It has no
    /// Notification event, and caps SessionEnd and Interrupt at 3 s.
    static let codex = HookTarget(
        id: "codex", name: "Codex", agent: "codex", settingsPath: ".codex/hooks.json",
        entries: [
            Entry(event: "SessionStart", matcher: nil, waits: false, timeout: 5),
            Entry(event: "UserPromptSubmit", matcher: nil, waits: false, timeout: 5),
            Entry(event: "PreToolUse", matcher: nil, waits: false, timeout: 5),
            Entry(event: "PostToolUse", matcher: nil, waits: false, timeout: 5),
            Entry(event: "PermissionRequest", matcher: nil, waits: true,
                  timeout: Int(BridgeProtocol.approvalWait) + 10),
            Entry(event: "Stop", matcher: nil, waits: false, timeout: 5),
            Entry(event: "SubagentStop", matcher: nil, waits: false, timeout: 5),
            Entry(event: "Interrupt", matcher: nil, waits: false, timeout: 3),
            Entry(event: "SessionEnd", matcher: nil, waits: false, timeout: 3),
        ],
        footer: "Codex runs new hooks only once you trust them: after installing, run /hooks in Codex and trust the Motes hooks."
    )

    /// Gemini CLI reads `~/.gemini/settings.json`. Its events have their own
    /// names (`BeforeAgent`, `BeforeTool`…), timeouts are in milliseconds, and
    /// no hook can answer a tool confirmation, so nothing waits.
    static let gemini = HookTarget(
        id: "gemini", name: "Gemini CLI", agent: "gemini", settingsPath: ".gemini/settings.json",
        entries: [
            Entry(event: "SessionStart", matcher: nil, waits: false, timeout: 5),
            Entry(event: "BeforeAgent", matcher: nil, waits: false, timeout: 5),
            Entry(event: "BeforeTool", matcher: "*", waits: false, timeout: 5),
            Entry(event: "AfterTool", matcher: "*", waits: false, timeout: 5),
            Entry(event: "Notification", matcher: nil, waits: false, timeout: 5),
            Entry(event: "AfterAgent", matcher: nil, waits: false, timeout: 5),
            Entry(event: "SessionEnd", matcher: nil, waits: false, timeout: 5),
        ],
        footer: "Gemini CLI can't take an answer from a hook: when it asks to run a tool, Motes shows it and takes you to the terminal.",
        timeoutScale: 1000
    )

    /// Cursor reads `~/.cursor/hooks.json`: a `version` and one flat list of
    /// entries per event. It asks before each shell command and MCP tool; those
    /// wait for the notch, and without an answer Cursor asks as usual.
    static let cursor = HookTarget(
        id: "cursor", name: "Cursor", agent: "cursor", settingsPath: ".cursor/hooks.json",
        entries: [
            Entry(event: "sessionStart", matcher: nil, waits: false, timeout: 5),
            Entry(event: "beforeSubmitPrompt", matcher: nil, waits: false, timeout: 5),
            Entry(event: "preToolUse", matcher: nil, waits: false, timeout: 5),
            Entry(event: "postToolUse", matcher: nil, waits: false, timeout: 5),
            Entry(event: "postToolUseFailure", matcher: nil, waits: false, timeout: 5),
            Entry(event: "beforeShellExecution", matcher: nil, waits: true,
                  timeout: Int(BridgeProtocol.approvalWait) + 10),
            Entry(event: "beforeMCPExecution", matcher: nil, waits: true,
                  timeout: Int(BridgeProtocol.approvalWait) + 10),
            Entry(event: "afterFileEdit", matcher: nil, waits: false, timeout: 5),
            Entry(event: "afterAgentResponse", matcher: nil, waits: false, timeout: 5),
            Entry(event: "stop", matcher: nil, waits: false, timeout: 5),
            Entry(event: "subagentStop", matcher: nil, waits: false, timeout: 5),
            Entry(event: "sessionEnd", matcher: nil, waits: false, timeout: 5),
        ],
        footer: "For the Cursor app and its CLI (cursor-agent). Cursor asks Motes before every shell command and MCP tool: allow or deny it from the notch, or let it wait and Cursor asks as usual. Cursor loads new hooks once restarted.",
        layout: .flat
    )

    static let all: [HookTarget] = [.claude, .codex, .gemini, .cursor]
}

/// Adds and removes Motes' entries in an agent's hook settings.
/// Pure: works on the decoded JSON object, never on files. Entries that aren't
/// Motes' own are never touched.
enum HookSettings {
    /// One hook entry Motes registers.
    struct Entry: Equatable {
        let event: String
        /// Tool matcher for tool events, `nil` for the others (or for every tool).
        let matcher: String?
        /// Waits for an answer from the notch (permission, question).
        let waits: Bool
        /// Seconds the agent waits for the hook.
        let timeout: Int
    }

    /// How entries sit under each event: in `{matcher, hooks: [...]}` groups
    /// (Claude Code, Codex, Gemini CLI), or as a flat list with their own
    /// matcher under a top-level `version` (Cursor).
    enum Layout: Equatable { case grouped, flat }

    /// Any hook command containing this is considered Motes'.
    static let marker = "motes-hook"

    enum Status: Equatable {
        case notInstalled
        case installed
        /// Some Motes entries exist but don't match the current hook path or entry list.
        case outdated
    }

    static func command(hookPath: String, agent: String? = nil, waits: Bool = false) -> String {
        "\"\(hookPath)\"" + (agent.map { " --agent \($0)" } ?? "") + (waits ? " --wait" : "")
    }

    static func status(of settings: [String: Any], target: HookTarget = .claude, hookPath: String) -> Status {
        let hooks = hookStatus(of: settings, target: target, hookPath: hookPath)
        guard target.wrapsStatusLine else { return hooks }
        switch hooks {
        case .installed:
            return StatusLineSettings.isInstalled(in: settings, hookPath: hookPath) ? .installed : .outdated
        case .notInstalled:
            return StatusLineSettings.motesCommand(in: settings) == nil ? .notInstalled : .outdated
        case .outdated:
            return .outdated
        }
    }

    private static func hookStatus(of settings: [String: Any], target: HookTarget, hookPath: String) -> Status {
        let hooks = settings["hooks"] as? [String: Any] ?? [:]
        // Every Motes entry found, as (event, matcher, command, timeout).
        var found: [(String, String?, String, Int?)] = []
        for (event, value) in hooks {
            guard let groups = value as? [Any] else { continue }
            for case let group as [String: Any] in groups {
                // A flat entry is its own group of one.
                let entries = group["hooks"] as? [Any] ?? (group["command"] != nil ? [group] : [])
                let matcher = group["matcher"] as? String
                for case let entry as [String: Any] in entries {
                    guard let command = entry["command"] as? String, command.contains(marker) else { continue }
                    found.append((event, matcher, command, entry["timeout"] as? Int))
                }
            }
        }
        if found.isEmpty { return .notInstalled }
        let expected = target.entries.map {
            ($0.event, $0.matcher, command(hookPath: hookPath, agent: target.agent, waits: $0.waits), $0.timeout * target.timeoutScale)
        }
        let matches = found.count == expected.count && expected.allSatisfy { e in
            found.contains { $0.0 == e.0 && $0.1 == e.1 && $0.2 == e.2 && $0.3 == e.3 }
        }
        return matches ? .installed : .outdated
    }

    /// Settings with Motes' hooks, replacing any previous Motes entries.
    static func installing(into settings: [String: Any], target: HookTarget = .claude, hookPath: String) -> [String: Any] {
        var result = removing(from: settings)
        var hooks = result["hooks"] as? [String: Any] ?? [:]
        for entry in target.entries {
            var groups = hooks[entry.event] as? [Any] ?? []
            let hook: [String: Any] = [
                "command": command(hookPath: hookPath, agent: target.agent, waits: entry.waits),
                "timeout": entry.timeout * target.timeoutScale,
            ]
            var group: [String: Any]
            switch target.layout {
            case .grouped: group = ["hooks": [hook.merging(["type": "command"]) { $1 }]]
            case .flat: group = hook
            }
            if let matcher = entry.matcher { group["matcher"] = matcher }
            groups.append(group)
            hooks[entry.event] = groups
        }
        result["hooks"] = hooks
        if target.layout == .flat, result["version"] == nil { result["version"] = 1 }
        return target.wrapsStatusLine ? StatusLineSettings.installing(into: result, hookPath: hookPath) : result
    }

    /// Settings without any Motes entry (and the user's status line back). Groups, events and the `hooks` key are
    /// dropped only when Motes' removal leaves them empty.
    static func removing(from settings: [String: Any]) -> [String: Any] {
        let settings = StatusLineSettings.removing(from: settings)
        guard var hooks = settings["hooks"] as? [String: Any] else { return settings }
        var result = settings
        for (event, value) in hooks {
            guard let groups = value as? [Any] else { continue }
            var kept: [Any] = []
            for case let group as [String: Any] in groups {
                guard let entries = group["hooks"] as? [Any] else {
                    // A flat entry (Cursor): dropped when it is Motes'.
                    if !(group["command"] as? String ?? "").contains(marker) { kept.append(group) }
                    continue
                }
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
