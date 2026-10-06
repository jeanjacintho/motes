import Foundation

/// Claude Code's status line, relayed by `motes-hook --statusline`: its JSON
/// carries the plan usage (`rate_limits`). The user's own status line command,
/// if any, rides along base64-encoded after `--then` (no quoting needed) and
/// still prints what it printed before.
enum StatusLineRelay {
    /// `hook_event_name` given to status line payloads, which have none.
    static let eventName = "StatusLine"
    static let flag = "--statusline"
    static let chainFlag = "--then"

    static func encode(_ command: String) -> String {
        Data(command.utf8).base64EncodedString()
    }

    static func decode(_ value: String) -> String? {
        guard let data = Data(base64Encoded: value), let command = String(data: data, encoding: .utf8),
              !command.isEmpty else { return nil }
        return command
    }

    /// What the status line shows when the user has none of their own: the plan
    /// usage, like `5h 23% · 7d 41%`, or `nil` when the payload has none.
    static func text(payload: Data) -> String? {
        guard let object = (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any],
              let limits = object["rate_limits"] as? [String: Any] else { return nil }
        let parts = [("five_hour", "5h"), ("seven_day", "7d"), ("spend_limit", "spend")].compactMap { key, label -> String? in
            guard let window = limits[key] as? [String: Any],
                  let used = (window["used_percentage"] as? NSNumber)?.doubleValue else { return nil }
            return "\(label) \(Int(used.rounded()))%"
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
