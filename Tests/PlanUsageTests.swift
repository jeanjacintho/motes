import Foundation
import Testing
@testable import Motes

struct PlanUsageTests {
    let rateLimits: [String: Any] = [
        "five_hour": ["used_percentage": 23.5, "resets_at": 1_000],
        "seven_day": ["used_percentage": 41, "resets_at": 5_000],
    ]

    @Test func parsesTheWindows() throws {
        let usage = try #require(PlanUsage.parse(rateLimits))
        #expect(usage.windows.map(\.kind) == [.fiveHour, .sevenDay])
        #expect(usage.windows[0].usedPercent == 23.5)
        #expect(usage.windows[1].usedPercent == 41)
        #expect(usage.windows[0].resetsAt == Date(timeIntervalSince1970: 1_000))
        #expect(usage.peak?.kind == .sevenDay)
        #expect(usage.nextReset == Date(timeIntervalSince1970: 1_000))
    }

    @Test func ignoresMissingOrBrokenWindows() {
        #expect(PlanUsage.parse(nil) == nil)
        #expect(PlanUsage.parse([String: Any]()) == nil)
        #expect(PlanUsage.parse(["five_hour": ["used_percentage": "lots", "resets_at": 1]]) == nil)
        let usage = PlanUsage.parse(["five_hour": ["used_percentage": 10], "seven_day": ["used_percentage": 5, "resets_at": 9]])
        #expect(usage?.windows.map(\.kind) == [.sevenDay])
    }

    @Test func windowsDropOnceTheyReset() throws {
        let usage = try #require(PlanUsage.parse(rateLimits))
        #expect(usage.current(at: Date(timeIntervalSince1970: 500)) == usage)
        #expect(usage.current(at: Date(timeIntervalSince1970: 1_000))?.windows.map(\.kind) == [.sevenDay])
        #expect(usage.current(at: Date(timeIntervalSince1970: 5_000)) == nil)
    }

    @Test func levelsFollowTheThresholds() {
        func level(_ used: Double) -> PlanUsage.Level {
            PlanUsage.Window(kind: .fiveHour, usedPercent: used, resetsAt: .distantFuture).level
        }
        #expect(level(69) == .normal)
        #expect(level(70) == .high)
        #expect(level(90) == .critical)
        #expect(level(120) == .critical)
    }

    @Test func idleClaudeMotesTireNearTheLimit() {
        let near = PlanUsage(windows: [.init(kind: .fiveHour, usedPercent: 92, resetsAt: .distantFuture)])
        let fine = PlanUsage(windows: [.init(kind: .fiveHour, usedPercent: 40, resetsAt: .distantFuture)])
        #expect(near.adjusted(.idle, agent: "claude") == .tired)
        #expect(near.adjusted(.working, agent: "claude") == .working)
        #expect(near.adjusted(.idle, agent: "codex") == .idle)
        #expect(fine.adjusted(.idle, agent: "claude") == .idle)
    }

    @Test func statusLineEventsCarryUsageOnly() throws {
        let payload = try JSONSerialization.data(withJSONObject: [
            "hook_event_name": StatusLineRelay.eventName, "session_id": "s1", "cwd": "/tmp/app",
            "rate_limits": rateLimits,
        ])
        let event = try #require(HookEvent.parse(payload))
        #expect(event.kind == .statusLine)
        #expect(event.usage?.windows.count == 2)

        var store = SessionStore()
        store.apply(event, at: .now)
        #expect(store.sessions.isEmpty)
    }
}

struct StatusLineRelayTests {
    @Test func commandsRoundTripThroughBase64() {
        let command = #"bash -c 'echo "$(jq -r .model.display_name)" | tr a-z A-Z' && ~/bin/line.sh"#
        let encoded = StatusLineRelay.encode(command)
        #expect(!encoded.contains(" ") && !encoded.contains("'") && !encoded.contains("\""))
        #expect(StatusLineRelay.decode(encoded) == command)
        #expect(StatusLineRelay.decode("not base64!") == nil)
        #expect(StatusLineRelay.decode("") == nil)
    }

    @Test func fallbackTextShowsThePlanUsage() throws {
        let payload = try JSONSerialization.data(withJSONObject: [
            "rate_limits": [
                "five_hour": ["used_percentage": 23.5, "resets_at": 1],
                "seven_day": ["used_percentage": 41.2, "resets_at": 2],
            ],
        ])
        #expect(StatusLineRelay.text(payload: payload) == "5h 24% · 7d 41%")
        #expect(StatusLineRelay.text(payload: Data(#"{"model":{}}"#.utf8)) == nil)
        #expect(StatusLineRelay.text(payload: Data("nope".utf8)) == nil)
    }
}

struct StatusLineSettingsTests {
    let path = "/Users/me/Library/Application Support/Motes/bin/motes-hook"

    @Test func addsAStatusLineWhenThereIsNone() {
        let result = StatusLineSettings.installing(into: [:], hookPath: path)
        let line = result["statusLine"] as? [String: Any]
        #expect(line?["type"] as? String == "command")
        #expect(line?["command"] as? String == "\"\(path)\" --statusline")
        #expect(StatusLineSettings.isInstalled(in: result, hookPath: path))
        #expect(StatusLineSettings.removing(from: result)["statusLine"] == nil)
    }

    @Test func wrapsTheUsersStatusLineAndPutsItBack() throws {
        let original: [String: Any] = [
            "statusLine": ["type": "command", "command": "~/.claude/statusline.sh 'a b'", "padding": 2],
            "model": "opus",
        ]
        let installed = StatusLineSettings.installing(into: original, hookPath: path)
        let line = try #require(installed["statusLine"] as? [String: Any])
        let command = try #require(line["command"] as? String)
        #expect(command.hasPrefix("\"\(path)\" --statusline --then "))
        #expect(StatusLineSettings.chained(in: command) == "~/.claude/statusline.sh 'a b'")
        #expect(line["padding"] as? Int == 2)
        #expect(StatusLineSettings.isInstalled(in: installed, hookPath: path))

        // Installing again keeps the user's command, not Motes' own.
        let again = StatusLineSettings.installing(into: installed, hookPath: path)
        #expect(NSDictionary(dictionary: again).isEqual(to: installed))

        let removed = StatusLineSettings.removing(from: installed)
        #expect(NSDictionary(dictionary: removed).isEqual(to: original))
    }

    @Test func aMovedHookNeedsAnUpdate() {
        let installed = StatusLineSettings.installing(into: [:], hookPath: "/old/motes-hook")
        #expect(!StatusLineSettings.isInstalled(in: installed, hookPath: path))
        let updated = StatusLineSettings.installing(into: installed, hookPath: path)
        #expect(StatusLineSettings.isInstalled(in: updated, hookPath: path))
    }

    @Test func leavesStatusLinesItCantWrapAlone() {
        let other: [String: Any] = ["statusLine": ["type": "something-else", "value": 1]]
        let result = StatusLineSettings.installing(into: other, hookPath: path)
        #expect(NSDictionary(dictionary: result).isEqual(to: other))
        #expect(StatusLineSettings.isInstalled(in: other, hookPath: path))
        #expect(NSDictionary(dictionary: StatusLineSettings.removing(from: other)).isEqual(to: other))
    }

    @Test func claudeHooksIncludeTheStatusLine() {
        let hooksOnly = StatusLineSettings.removing(from: HookSettings.installing(into: [:], hookPath: path))
        #expect(hooksOnly["hooks"] != nil)
        #expect(HookSettings.status(of: hooksOnly, hookPath: path) == .outdated)

        let lineOnly = StatusLineSettings.installing(into: [:], hookPath: path)
        #expect(HookSettings.status(of: lineOnly, hookPath: path) == .outdated)

        let full = HookSettings.installing(into: hooksOnly, hookPath: path)
        #expect(HookSettings.status(of: full, hookPath: path) == .installed)
        #expect(HookSettings.removing(from: full).isEmpty)
    }

    @Test func codexHasNoStatusLine() {
        let result = HookSettings.installing(into: [:], target: .codex, hookPath: path)
        #expect(result["statusLine"] == nil)
        #expect(HookSettings.status(of: result, target: .codex, hookPath: path) == .installed)
    }
}
