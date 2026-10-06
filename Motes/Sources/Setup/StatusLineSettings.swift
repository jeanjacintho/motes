import Foundation

/// Puts Motes in front of Claude Code's `statusLine` to read the plan usage.
/// The user's own command is kept inside Motes' (`--then`, base64) and runs as
/// before; removing Motes puts it back. Pure: works on the decoded settings.
enum StatusLineSettings {
    static let key = "statusLine"

    static func command(hookPath: String, chained: String?) -> String {
        "\"\(hookPath)\" \(StatusLineRelay.flag)"
            + (chained.map { " \(StatusLineRelay.chainFlag) \(StatusLineRelay.encode($0))" } ?? "")
    }

    /// The status line command when it is Motes'.
    static func motesCommand(in settings: [String: Any]) -> String? {
        guard let command = (settings[key] as? [String: Any])?["command"] as? String,
              command.contains(HookSettings.marker) else { return nil }
        return command
    }

    /// The user's command carried by Motes' one.
    static func chained(in command: String) -> String? {
        let parts = command.split(separator: " ")
        guard let index = parts.firstIndex(of: Substring(StatusLineRelay.chainFlag)), index + 1 < parts.count else { return nil }
        return StatusLineRelay.decode(String(parts[index + 1]))
    }

    /// A status line that isn't a command can't be wrapped; Motes leaves it alone.
    private static func isWrappable(_ settings: [String: Any]) -> Bool {
        guard let line = settings[key] else { return true }
        guard let line = line as? [String: Any] else { return false }
        return (line["type"] as? String ?? "command") == "command"
    }

    /// Motes' status line is in place with the current hook path (or can't be).
    static func isInstalled(in settings: [String: Any], hookPath: String) -> Bool {
        guard isWrappable(settings) else { return true }
        guard let command = motesCommand(in: settings) else { return false }
        return command == Self.command(hookPath: hookPath, chained: chained(in: command))
    }

    static func installing(into settings: [String: Any], hookPath: String) -> [String: Any] {
        guard isWrappable(settings) else { return settings }
        var line = settings[key] as? [String: Any] ?? [:]
        let current = line["command"] as? String
        let chained = current.flatMap { $0.contains(HookSettings.marker) ? Self.chained(in: $0) : ($0.isEmpty ? nil : $0) }
        line["type"] = "command"
        line["command"] = command(hookPath: hookPath, chained: chained)
        var result = settings
        result[key] = line
        return result
    }

    /// Puts the user's status line back, or drops the one Motes added.
    static func removing(from settings: [String: Any]) -> [String: Any] {
        guard let command = motesCommand(in: settings), var line = settings[key] as? [String: Any] else { return settings }
        var result = settings
        if let chained = chained(in: command) {
            line["command"] = chained
            result[key] = line
        } else {
            result[key] = nil
        }
        return result
    }
}
