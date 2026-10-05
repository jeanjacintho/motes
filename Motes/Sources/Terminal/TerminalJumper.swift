import AppKit
import os

/// Where to send the user to reach a session.
enum JumpTarget: Equatable {
    /// A tab of macOS Terminal, found by its device; activates Terminal if `tty` is nil.
    case terminalTab(tty: String?)
    /// A Code session in the Claude desktop app, by its CLI session ID.
    case claudeDesktop(cliSessionID: String)
    /// Bring an app to the front: an IDE, another terminal.
    case app(bundleID: String)
    case none

    static let terminalBundleID = "com.apple.Terminal"

    /// Terminals that don't set `__CFBundleIdentifier` but do set `TERM_PROGRAM`.
    private static let knownTerminals: [String: String] = [
        "iTerm.app": "com.googlecode.iterm2",
        "WarpTerminal": "dev.warp.Warp-Stable",
        "ghostty": "com.mitchellh.ghostty",
        "WezTerm": "com.github.wez.wezterm",
    ]

    /// Picks the target from the context the hook sent (`motes_terminal`) and the session's ID.
    static func resolve(_ terminal: [String: String], sessionID: String) -> JumpTarget {
        let tty = terminal[BridgeProtocol.Key.tty].flatMap { TerminalTTY.isValid($0) ? $0 : nil }
        if terminal["TERM_PROGRAM"] == "Apple_Terminal" || terminal["__CFBundleIdentifier"] == terminalBundleID {
            return .terminalTab(tty: tty)
        }
        if let bundle = terminal["__CFBundleIdentifier"], !bundle.isEmpty {
            return bundle == ClaudeDesktopSessions.bundleID ? .claudeDesktop(cliSessionID: sessionID) : .app(bundleID: bundle)
        }
        if let program = terminal["TERM_PROGRAM"], let bundle = knownTerminals[program] {
            return .app(bundleID: bundle)
        }
        // Started from a Motes terminal but the context is missing: Terminal is the best guess.
        if tty != nil { return .terminalTab(tty: tty) }
        return .none
    }
}

/// Brings the window of a session to the front.
enum TerminalJumper {
    private static let log = Logger(subsystem: "app.motes", category: "terminal")

    /// Selects the Terminal tab using `tty` and raises its window. The tty is
    /// passed as an argument, never spliced into the script.
    static let selectTabScript = """
    on run argv
        set wanted to item 1 of argv
        tell application "Terminal"
            repeat with w in windows
                repeat with t in tabs of w
                    if tty of t is wanted then
                        set selected of t to true
                        set index of w to 1
                        activate
                        return "found"
                    end if
                end repeat
            end repeat
            activate
        end tell
        return "missing"
    end run
    """

    @MainActor
    static func jump(to session: AgentSession) {
        perform(JumpTarget.resolve(session.terminal, sessionID: session.id))
    }

    @MainActor
    static func perform(_ target: JumpTarget) {
        switch target {
        case .none:
            log.notice("No terminal context to jump to")
        case .app(let bundleID):
            activate(bundleID: bundleID)
        case .claudeDesktop(let cliSessionID):
            // Reads the app's session files off the main thread.
            DispatchQueue.global(qos: .userInitiated).async {
                let url = ClaudeDesktopSessions.localSessionID(forCLISession: cliSessionID)
                    .flatMap(ClaudeDesktopSessions.continueURL(localSessionID:))
                DispatchQueue.main.async {
                    if let url {
                        NSWorkspace.shared.open(url)
                    } else {
                        log.notice("Claude desktop session not found; bringing the app forward")
                        activate(bundleID: ClaudeDesktopSessions.bundleID)
                    }
                }
            }
        case .terminalTab(nil):
            activate(bundleID: JumpTarget.terminalBundleID)
        case .terminalTab(let tty?):
            // osascript, off the main thread: the first run may show the Automation prompt.
            DispatchQueue.global(qos: .userInitiated).async {
                let ok = runSelectTab(tty: tty)
                if !ok {
                    DispatchQueue.main.async { activate(bundleID: JumpTarget.terminalBundleID) }
                }
            }
        }
    }

    private static func activate(bundleID: String) {
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first {
            app.activate()
        } else if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
            NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        } else {
            log.notice("Can't find the app \(bundleID, privacy: .public)")
        }
    }

    /// Returns true when the tab was found and selected.
    private static func runSelectTab(tty: String) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", selectTabScript, tty]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            log.error("osascript failed: \(error.localizedDescription, privacy: .public)")
            return false
        }
        let result = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        if process.terminationStatus != 0 {
            // Most often: Automation permission denied in System Settings.
            log.notice("Couldn't select the Terminal tab (status \(process.terminationStatus, privacy: .public))")
            return false
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines) == "found"
    }
}
