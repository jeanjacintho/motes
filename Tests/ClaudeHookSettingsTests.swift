import Foundation
import Testing
@testable import Motes

struct ClaudeHookSettingsTests {
    let path = "/Users/me/Library/Application Support/Motes/bin/motes-hook"

    func json(_ text: String) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
    }

    func same(_ a: [String: Any], _ b: [String: Any]) -> Bool {
        NSDictionary(dictionary: a).isEqual(to: b)
    }

    @Test func installIntoEmptySettings() {
        let result = ClaudeHookSettings.installing(into: [:], hookPath: path)
        #expect(ClaudeHookSettings.status(of: result, hookPath: path) == .installed)
        let hooks = result["hooks"] as? [String: Any] ?? [:]
        #expect(Set(hooks.keys) == Set(ClaudeHookSettings.entries.map(\.event)))
        let pre = (hooks["PreToolUse"] as? [[String: Any]])?.first
        #expect(pre?["matcher"] as? String == "*")
        let entry = (pre?["hooks"] as? [[String: Any]])?.first
        #expect(entry?["command"] as? String == "\"\(path)\"")
        #expect(entry?["type"] as? String == "command")
    }

    @Test func waitingEntriesCanWaitForTheUser() {
        let hooks = ClaudeHookSettings.installing(into: [:], hookPath: path)["hooks"] as! [String: Any]
        let permission = ((hooks["PermissionRequest"] as? [[String: Any]])?.first?["hooks"] as? [[String: Any]])?.first
        #expect(permission?["command"] as? String == "\"\(path)\" --wait")
        #expect((permission?["timeout"] as? Int ?? 0) > Int(BridgeProtocol.approvalWait))

        let pre = hooks["PreToolUse"] as! [[String: Any]]
        let ask = pre.first { $0["matcher"] as? String == "AskUserQuestion" }
        let askEntry = (ask?["hooks"] as? [[String: Any]])?.first
        #expect(askEntry?["command"] as? String == "\"\(path)\" --wait")
        #expect((askEntry?["timeout"] as? Int ?? 0) > Int(BridgeProtocol.questionWait))

        // The catch-all listener never waits.
        let all = pre.first { $0["matcher"] as? String == "*" }
        #expect(((all?["hooks"] as? [[String: Any]])?.first?["command"] as? String) == "\"\(path)\"")
    }

    @Test func installFromBeforeAnswersIsOutdated() throws {
        // What M3 installed: one listening entry per event, no waiting entries.
        var hooks: [String: Any] = [:]
        for event in ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest",
                      "Notification", "Stop", "SubagentStop", "SessionEnd"] {
            hooks[event] = [["hooks": [["type": "command", "command": "\"\(path)\"", "timeout": 5]]]]
        }
        #expect(ClaudeHookSettings.status(of: ["hooks": hooks], hookPath: path) == .outdated)
        let updated = ClaudeHookSettings.installing(into: ["hooks": hooks], hookPath: path)
        #expect(ClaudeHookSettings.status(of: updated, hookPath: path) == .installed)
    }

    @Test func installKeepsEverythingElse() throws {
        let original = try json("""
        {"model":"opus","permissions":{"allow":["Bash(npm test)"]},
         "hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/usr/local/bin/guard"}]}],
                  "PreCompact":[{"hooks":[{"type":"command","command":"echo hi"}]}]}}
        """)
        let result = ClaudeHookSettings.installing(into: original, hookPath: path)
        #expect(result["model"] as? String == "opus")
        #expect(same(result["permissions"] as? [String: Any] ?? [:], original["permissions"] as! [String: Any]))
        let hooks = result["hooks"] as! [String: Any]
        let pre = hooks["PreToolUse"] as! [[String: Any]]
        // The user's group, then Motes' catch-all and AskUserQuestion groups.
        #expect(pre.count == 3)
        #expect(pre[0]["matcher"] as? String == "Bash")
        #expect(hooks["PreCompact"] != nil)
    }

    @Test func installThenRemoveRestoresTheOriginal() throws {
        let original = try json("""
        {"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"say done"}]}]}}
        """)
        let roundTrip = ClaudeHookSettings.removing(from: ClaudeHookSettings.installing(into: original, hookPath: path))
        #expect(same(roundTrip, original))
    }

    @Test func removeDropsEmptyHooksKey() {
        let installed = ClaudeHookSettings.installing(into: ["model": "opus"], hookPath: path)
        let removed = ClaudeHookSettings.removing(from: installed)
        #expect(removed["hooks"] == nil)
        #expect(removed["model"] as? String == "opus")
    }

    @Test func removeKeepsOtherCommandsInTheSameGroup() throws {
        let settings = try json("""
        {"hooks":{"Stop":[{"hooks":[{"type":"command","command":"say done"},{"type":"command","command":"\\"/x/motes-hook\\""}]}]}}
        """)
        let removed = ClaudeHookSettings.removing(from: settings)
        let entries = ((removed["hooks"] as? [String: Any])?["Stop"] as? [[String: Any]])?.first?["hooks"] as? [[String: Any]]
        #expect(entries?.count == 1)
        #expect(entries?.first?["command"] as? String == "say done")
    }

    @Test func installTwiceDoesNotDuplicate() {
        let once = ClaudeHookSettings.installing(into: [:], hookPath: path)
        let twice = ClaudeHookSettings.installing(into: once, hookPath: path)
        #expect(same(once, twice))
    }

    @Test func movedHookIsOutdatedAndUpdateFixesIt() {
        let old = ClaudeHookSettings.installing(into: [:], hookPath: "/old/motes-hook")
        #expect(ClaudeHookSettings.status(of: old, hookPath: path) == .outdated)
        let updated = ClaudeHookSettings.installing(into: old, hookPath: path)
        #expect(ClaudeHookSettings.status(of: updated, hookPath: path) == .installed)
    }

    @Test func notInstalled() throws {
        #expect(ClaudeHookSettings.status(of: [:], hookPath: path) == .notInstalled)
        #expect(ClaudeHookSettings.status(of: try json(#"{"hooks":{"Stop":[]}}"#), hookPath: path) == .notInstalled)
    }

    @Test func missingEventIsOutdated() {
        var settings = ClaudeHookSettings.installing(into: [:], hookPath: path)
        var hooks = settings["hooks"] as! [String: Any]
        hooks["Stop"] = nil
        settings["hooks"] = hooks
        #expect(ClaudeHookSettings.status(of: settings, hookPath: path) == .outdated)
        #expect(ClaudeHookSettings.status(of: settings, hookPath: path) == .outdated)
    }
}

struct LineDiffTests {
    @Test func diff() {
        let lines = LineDiff.diff(["a", "b", "c"], ["a", "x", "c", "d"])
        #expect(lines == [.same("a"), .added("x"), .removed("b"), .same("c"), .added("d")])
    }

    @Test func renderFoldsLongUnchangedRuns() {
        let old = (1...20).map(String.init)
        var new = old
        new[10] = "changed"
        let text = LineDiff.render(LineDiff.diff(old, new))
        #expect(text.contains("+ changed"))
        #expect(text.contains("- 11"))
        #expect(text.contains("  …"))
        #expect(!text.contains("  1\n"))
    }
}

@MainActor
struct ClaudeHookInstallerTests {
    func temporarySettings(_ contents: String?) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("settings.json")
        if let contents { try Data(contents.utf8).write(to: url) }
        return url
    }

    @Test func installBacksUpAndWrites() throws {
        let url = try temporarySettings(#"{"model":"opus"}"#)
        let installer = ClaudeHookInstaller(settingsURL: url, hookPath: "/x/motes-hook")
        #expect(installer.status == .notInstalled)
        let plan = try #require(installer.plan(.install))
        #expect(plan.diff.contains("+ "))
        // Nothing is written by planning.
        #expect(try String(contentsOf: url, encoding: .utf8) == #"{"model":"opus"}"#)

        installer.apply(plan)
        #expect(installer.status == .installed)
        let backup = try #require(installer.lastBackup)
        #expect(try String(contentsOf: backup, encoding: .utf8) == #"{"model":"opus"}"#)

        let uninstall = try #require(installer.plan(.uninstall))
        installer.apply(uninstall)
        #expect(installer.status == .notInstalled)
    }

    @Test func missingFileIsCreatedWithoutBackup() throws {
        let url = try temporarySettings(nil)
        let installer = ClaudeHookInstaller(settingsURL: url, hookPath: "/x/motes-hook")
        installer.apply(try #require(installer.plan(.install)))
        #expect(installer.status == .installed)
        #expect(installer.lastBackup == nil)
    }

    @Test func invalidJSONIsNeverTouched() throws {
        let url = try temporarySettings("{ not json")
        let installer = ClaudeHookInstaller(settingsURL: url, hookPath: "/x/motes-hook")
        #expect(installer.lastError != nil)
        #expect(installer.plan(.install) == nil)
        #expect(try String(contentsOf: url, encoding: .utf8) == "{ not json")
    }

    @Test func backupNamesDontCollide() throws {
        let url = try temporarySettings("{}")
        let date = Date(timeIntervalSinceReferenceDate: 0)
        let first = ClaudeHookInstaller.backupURL(for: url, date: date)
        try Data().write(to: first)
        let second = ClaudeHookInstaller.backupURL(for: url, date: date)
        #expect(first != second)
        #expect(second.lastPathComponent.hasSuffix("-2"))
    }
}
