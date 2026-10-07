import Foundation
import os

/// Types a line into a Terminal tab, found by its device, followed by Return.
/// Terminal's `do script … in tab` sends the text as keystrokes to whatever
/// runs there (the agent), without bringing Terminal to the front.
enum TerminalTyper {
    enum Result: Equatable {
        case sent
        /// No tab with that device: the session's terminal was closed.
        case missing
        /// Most often: Motes isn't allowed to control Terminal (System Settings → Automation).
        case failed
    }

    private static let log = Logger(subsystem: "app.motes", category: "terminal")

    /// The tty and the text are passed as arguments, never spliced into the script.
    /// The text goes base64-encoded: `Process` turns arguments into decomposed
    /// UTF-8 ("á" would arrive as "a" + a combining accent).
    static let typeScript = """
    on run argv
        set wanted to item 1 of argv
        set message to do shell script "/usr/bin/printf %s " & quoted form of (item 2 of argv) & " | /usr/bin/base64 -D"
        tell application "Terminal"
            repeat with w in windows
                repeat with t in tabs of w
                    if tty of t is wanted then
                        do script message in t
                        return "sent"
                    end if
                end repeat
            end repeat
        end tell
        return "missing"
    end run
    """

    static func type(_ line: String, tty: String) async -> Result {
        guard TerminalTTY.isValid(tty) else { return .missing }
        return await Task.detached(priority: .userInitiated) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            process.arguments = ["-e", typeScript, tty, Data(line.utf8).base64EncodedString()]
            let output = Pipe()
            process.standardOutput = output
            process.standardError = Pipe()
            do {
                try process.run()
                process.waitUntilExit()
            } catch {
                log.error("osascript failed: \(error.localizedDescription, privacy: .public)")
                return .failed
            }
            let result = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            guard process.terminationStatus == 0 else {
                log.notice("Couldn't type into Terminal (status \(process.terminationStatus, privacy: .public))")
                return .failed
            }
            return result.trimmingCharacters(in: .whitespacesAndNewlines) == "sent" ? .sent : .missing
        }.value
    }
}
