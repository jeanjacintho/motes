import AppKit
import Carbon.HIToolbox
import Foundation
import Testing
@testable import Motes

struct TerminalTTYTests {
    @Test(arguments: ["/dev/ttys0", "/dev/ttys003", "/dev/ttys1234"])
    func validDevices(_ tty: String) {
        #expect(TerminalTTY.isValid(tty))
    }

    @Test(arguments: ["", "/dev/ttys", "/dev/tty", "/dev/console", "/dev/ttys12345", "/dev/ttys1\" & quit", "ttys003", "/dev/ttysabc"])
    func invalidDevices(_ tty: String) {
        #expect(!TerminalTTY.isValid(tty))
    }

    @Test func currentIsValidOrNil() {
        // Under xcodebuild there may be no terminal; when there is one it must be well formed.
        if let tty = TerminalTTY.current() { #expect(TerminalTTY.isValid(tty)) }
    }

    @Test func relayAddsAValidTTYOnly() throws {
        let payload = Data(#"{"hook_event_name":"Stop","session_id":"s"}"#.utf8)
        let good = try #require(HookRelay.message(payload: payload, agent: nil, eventName: nil, environment: [:], tty: "/dev/ttys004"))
        #expect(try #require(HookEvent.parse(good.dropLast())).terminal["tty"] == "/dev/ttys004")
        let bad = try #require(HookRelay.message(payload: payload, agent: nil, eventName: nil, environment: [:], tty: "/dev/ttys1; rm"))
        #expect(try #require(HookEvent.parse(bad.dropLast())).terminal["tty"] == nil)
    }
}

struct JumpTargetTests {
    @Test func appleTerminalSelectsTheTab() {
        #expect(JumpTarget.resolve(["TERM_PROGRAM": "Apple_Terminal", "tty": "/dev/ttys003"], sessionID: "s") == .terminalTab(tty: "/dev/ttys003"))
        #expect(JumpTarget.resolve(["__CFBundleIdentifier": "com.apple.Terminal"], sessionID: "s") == .terminalTab(tty: nil))
    }

    @Test func otherAppsAreActivated() {
        #expect(JumpTarget.resolve(["__CFBundleIdentifier": "com.anthropic.claudefordesktop"], sessionID: "abc") == .claudeDesktop(cliSessionID: "abc"))
        #expect(JumpTarget.resolve(["TERM_PROGRAM": "vscode", "__CFBundleIdentifier": "com.microsoft.VSCode"], sessionID: "s") == .app(bundleID: "com.microsoft.VSCode"))
        #expect(JumpTarget.resolve(["TERM_PROGRAM": "iTerm.app"], sessionID: "s") == .app(bundleID: "com.googlecode.iterm2"))
    }

    @Test func invalidTTYIsIgnored() {
        #expect(JumpTarget.resolve(["TERM_PROGRAM": "Apple_Terminal", "tty": "/dev/ttys1\" & do shell script"], sessionID: "s") == .terminalTab(tty: nil))
    }

    @Test func ttyAloneMeansTerminal() {
        #expect(JumpTarget.resolve(["tty": "/dev/ttys009"], sessionID: "s") == .terminalTab(tty: "/dev/ttys009"))
    }

    @Test func nothingKnown() {
        #expect(JumpTarget.resolve([:], sessionID: "s") == .none)
        #expect(JumpTarget.resolve(["TERM_PROGRAM": "unknown-term"], sessionID: "s") == .none)
    }

    @Test func selectTabScriptCompiles() throws {
        let output = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID()).scpt")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osacompile")
        process.arguments = ["-o", output.path, "-e", TerminalJumper.selectTabScript]
        process.standardError = Pipe()
        try process.run()
        process.waitUntilExit()
        #expect(process.terminationStatus == 0)
    }
}

struct HotKeyTests {
    @Test func defaultIsControlOptionM() {
        #expect(HotKey.default.display == "⌃⌥M")
        #expect(HotKey.default.isUsable)
        #expect(HotKey.default.carbonModifiers == UInt32(controlKey | optionKey))
    }

    @Test func displayOrder() {
        let all = HotKey(keyCode: 0, modifiers: NSEvent.ModifierFlags([.command, .shift, .option, .control]).rawValue, key: "a")
        #expect(all.display == "⌃⌥⇧⌘A")
        #expect(all.carbonModifiers == UInt32(cmdKey | shiftKey | optionKey | controlKey))
    }

    @Test func needsARealModifier() {
        #expect(!HotKey(keyCode: 0, modifiers: 0, key: "a").isUsable)
        #expect(!HotKey(keyCode: 0, modifiers: NSEvent.ModifierFlags.shift.rawValue, key: "a").isUsable)
        #expect(HotKey(keyCode: 0, modifiers: NSEvent.ModifierFlags.command.rawValue, key: "a").isUsable)
    }
}

@MainActor
struct PreferencesTests {
    func defaults() -> UserDefaults {
        let name = "motes-tests-\(UUID())"
        return UserDefaults(suiteName: name)!
    }

    @Test func shortcutIsSavedAndReported() {
        let store = defaults()
        let preferences = Preferences(defaults: store)
        #expect(preferences.hotKey == .default)
        var registered: [HotKey?] = []
        preferences.onHotKeyChange = { registered.append($0) }

        let custom = HotKey(keyCode: UInt32(kVK_ANSI_K), modifiers: NSEvent.ModifierFlags([.command, .option]).rawValue, key: "k")
        preferences.setHotKey(custom)
        #expect(Preferences(defaults: store).hotKey == custom)

        preferences.setHotKeyEnabled(false)
        #expect(registered == [custom, nil])
        #expect(Preferences(defaults: store).activeHotKey == nil)
    }

    @Test func unusableShortcutIsRefused() {
        let preferences = Preferences(defaults: defaults())
        preferences.setHotKey(HotKey(keyCode: 0, modifiers: 0, key: "a"))
        #expect(preferences.hotKey == .default)
        #expect(preferences.lastError != nil)
    }
}

struct ClaudeDesktopSessionsTests {
    /// Builds the app's folder layout: <root>/<org>/<account>/local_<id>.json
    func sessions(_ files: [String: [String: Any]]) throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let folder = root.appendingPathComponent("org/account")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for (name, object) in files {
            try JSONSerialization.data(withJSONObject: object).write(to: folder.appendingPathComponent(name))
        }
        return root
    }

    @Test func findsTheAppsIDForACLISession() throws {
        let root = try sessions([
            "local_aaa.json": ["sessionId": "local_aaa", "cliSessionId": "cli-1", "title": "One", "turns": [1, 2]],
            "local_bbb.json": ["sessionId": "local_bbb", "cliSessionId": "cli-2"],
        ])
        #expect(ClaudeDesktopSessions.localSessionID(forCLISession: "cli-2", in: root) == "local_bbb")
        #expect(ClaudeDesktopSessions.localSessionID(forCLISession: "missing", in: root) == nil)
        #expect(ClaudeDesktopSessions.localSessionID(forCLISession: "", in: root) == nil)
    }

    @Test func ignoresUnexpectedFiles() throws {
        let root = try sessions([
            "local_bad.json": ["sessionId": "local_x\" & quit", "cliSessionId": "cli-1"],
            "other.json": ["sessionId": "local_ok", "cliSessionId": "cli-1"],
            "local_partial.json": ["cliSessionId": "cli-1"],
        ])
        #expect(ClaudeDesktopSessions.localSessionID(forCLISession: "cli-1", in: root) == nil)
    }

    @Test func missingFolderIsFine() {
        let nowhere = URL(fileURLWithPath: "/tmp/motes-nowhere-\(UUID())")
        #expect(ClaudeDesktopSessions.localSessionID(forCLISession: "cli-1", in: nowhere) == nil)
    }

    @Test func continueURL() {
        #expect(ClaudeDesktopSessions.continueURL(localSessionID: "local_e427425d-205e-402a")?.absoluteString
                == "claude://code/continue?session=local_e427425d-205e-402a")
        #expect(ClaudeDesktopSessions.continueURL(localSessionID: "75c66921-dfb0") == nil)
        #expect(ClaudeDesktopSessions.continueURL(localSessionID: "local_") == nil)
        #expect(ClaudeDesktopSessions.continueURL(localSessionID: "local_a&b=c") == nil)
    }
}
