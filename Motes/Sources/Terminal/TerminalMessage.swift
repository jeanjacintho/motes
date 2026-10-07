import Foundation

/// A message typed into a session's Terminal tab, as if the user typed it
/// there: one line, then Return. Pure.
enum TerminalMessage {
    static let maxLength = 4_000

    enum Availability: Equatable {
        case ready(tty: String)
        /// The terminal is asking for an approval or an answer: typed text could answer it.
        case waitingForAnswer
        /// Not in a macOS Terminal tab Motes can find (another terminal, the desktop app).
        case unsupported
    }

    static func availability(of session: AgentSession) -> Availability {
        guard case .terminalTab(let tty?) = JumpTarget.resolve(session.terminal, sessionID: session.id) else {
            return .unsupported
        }
        switch session.state {
        case .approval, .question: return .waitingForAnswer
        default: return .ready(tty: tty)
        }
    }

    /// The line to type: the files' paths, then the text. Line breaks become
    /// spaces and other control characters are dropped, so nothing but text
    /// reaches the terminal (no Return mid-message, no escape sequences).
    /// `nil` when there is nothing to send.
    static func line(text: String, files: [String] = []) -> String? {
        let parts = files.map(quoted) + [clean(text)]
        let line = parts.filter { !$0.isEmpty }.joined(separator: " ")
        guard !line.isEmpty else { return nil }
        return line.count > maxLength ? String(line.prefix(maxLength)) : line
    }

    /// A path the agent can read back: quoted when it has spaces.
    static func quoted(_ path: String) -> String {
        let path = clean(path).replacingOccurrences(of: "\"", with: "")
        return path.contains(" ") ? "\"\(path)\"" : path
    }

    static func clean(_ text: String) -> String {
        var scalars = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            let category = scalar.properties.generalCategory
            if scalar == "\n" || scalar == "\r" || scalar == "\t" || category == .lineSeparator || category == .paragraphSeparator {
                scalars.append(" ")
            } else if category != .control {
                // Other control characters (ESC, ^C…) are dropped.
                scalars.append(scalar)
            }
        }
        return String(scalars).trimmingCharacters(in: .whitespaces)
    }
}
