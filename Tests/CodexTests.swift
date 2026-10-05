import Foundation
import Testing
@testable import Motes

struct CodexHookSettingsTests {
    let path = "/Users/me/Library/Application Support/Motes/bin/motes-hook"
    let codex = HookTarget.codex

    func entries(_ settings: [String: Any]) -> [(event: String, matcher: String?, command: String, timeout: Int?)] {
        let hooks = settings["hooks"] as? [String: Any] ?? [:]
        return hooks.flatMap { event, value in
            (value as? [[String: Any]] ?? []).flatMap { group in
                (group["hooks"] as? [[String: Any]] ?? []).map {
                    (event, group["matcher"] as? String, $0["command"] as? String ?? "", $0["timeout"] as? Int)
                }
            }
        }
    }

    @Test func registersCodexEventsTaggedAsCodex() {
        let installed = entries(HookSettings.installing(into: [:], target: codex, hookPath: path))
        #expect(Set(installed.map(\.event)) == ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
                                                 "PermissionRequest", "Stop", "SubagentStop", "Interrupt", "SessionEnd"])
        #expect(installed.allSatisfy { $0.command.hasPrefix("\"\(path)\" --agent codex") })
        // Codex has no Notification event and matches every tool when there is no matcher.
        #expect(installed.allSatisfy { $0.matcher == nil })
    }

    @Test func onlyPermissionsWait() {
        let installed = entries(HookSettings.installing(into: [:], target: codex, hookPath: path))
        let waiting = installed.filter { $0.command.hasSuffix("--wait") }
        #expect(waiting.map(\.event) == ["PermissionRequest"])
        #expect((waiting.first?.timeout ?? 0) > Int(BridgeProtocol.approvalWait))
    }

    @Test func respectsCodexTimeoutCaps() {
        let installed = entries(HookSettings.installing(into: [:], target: codex, hookPath: path))
        for entry in installed where entry.event == "SessionEnd" || entry.event == "Interrupt" {
            #expect((entry.timeout ?? 99) <= 3)
        }
    }

    @Test func statusIsPerTarget() {
        let codexInstalled = HookSettings.installing(into: [:], target: codex, hookPath: path)
        #expect(HookSettings.status(of: codexInstalled, target: codex, hookPath: path) == .installed)
        // The Claude layout in a Codex file isn't a correct Codex install.
        let claudeLayout = HookSettings.installing(into: [:], target: .claude, hookPath: path)
        #expect(HookSettings.status(of: claudeLayout, target: codex, hookPath: path) == .outdated)
    }

    @Test func installThenRemoveRestoresTheFile() throws {
        let original = try #require(try JSONSerialization.jsonObject(with: Data("""
        {"hooks":{"Stop":[{"hooks":[{"type":"command","command":"notify-send done"}]}]}}
        """.utf8)) as? [String: Any])
        let roundTrip = HookSettings.removing(from: HookSettings.installing(into: original, target: codex, hookPath: path))
        #expect(NSDictionary(dictionary: roundTrip).isEqual(to: original))
    }

    @Test @MainActor func installerWritesTheCodexFile() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let url = dir.appendingPathComponent("hooks.json")
        let installer = HookInstaller(target: codex, settingsURL: url, hookPath: path)
        #expect(installer.status == .notInstalled)
        installer.apply(try #require(installer.plan(.install)))
        #expect(installer.status == .installed)
        #expect(FileManager.default.fileExists(atPath: url.path))
    }
}

struct CodexAlertTests {
    let now = Date(timeIntervalSinceReferenceDate: 0)

    func event(_ kind: HookEvent.Kind, agent: String, tool: String, input: [String: String] = [:]) -> HookEvent {
        var e = HookEvent(kind: kind, sessionID: "s", agent: agent)
        e.toolName = tool
        e.toolInput = input
        e.rawToolInput = try? JSONSerialization.data(withJSONObject: input)
        e.wait = 110
        return e
    }

    @Test func codexGetsApprovals() {
        let alert = PendingAlert.make(from: event(.permissionRequest, agent: "codex", tool: "Bash", input: ["command": "npm test"]), id: UUID(), at: now)
        guard case .approval(let approval)? = alert?.kind else { Issue.record("no approval"); return }
        #expect(approval.detail == "npm test")
        #expect(approval.alwaysRule == nil)
    }

    @Test func codexNeverGetsQuestionsAndOthersGetNothing() {
        let ask = event(.preToolUse, agent: "codex", tool: "AskUserQuestion")
        #expect(PendingAlert.make(from: ask, id: UUID(), at: now) == nil)
        let other = event(.permissionRequest, agent: "gemini", tool: "Bash", input: ["command": "ls"])
        #expect(PendingAlert.make(from: other, id: UUID(), at: now) == nil)
    }

    @Test func claudeStillGetsBoth() {
        let approval = event(.permissionRequest, agent: "claude", tool: "Bash", input: ["command": "ls"])
        #expect(PendingAlert.make(from: approval, id: UUID(), at: now) != nil)
    }

    let patch = """
    *** Begin Patch
    *** Update File: Sources/App/AppDelegate.swift
    @@
    -old
    +new
    *** Add File: Sources/App/New.swift
    +hello
    *** End Patch
    """

    @Test func patchApprovalShowsFiles() {
        let alert = PendingAlert.make(from: event(.permissionRequest, agent: "codex", tool: "apply_patch", input: ["command": patch]), id: UUID(), at: now)
        guard case .approval(let approval)? = alert?.kind else { Issue.record("no approval"); return }
        #expect(approval.detail == "Sources/App/AppDelegate.swift\nSources/App/New.swift")
        #expect(approval.summary == "Edit AppDelegate.swift +1")
    }

    @Test func patchLabels() {
        #expect(ActivityLabel.tool("apply_patch", input: ["command": patch]) == "Edit AppDelegate.swift +1")
        #expect(ActivityLabel.tool("apply_patch", input: ["command": "*** Delete File: old.txt"]) == "Delete old.txt")
        #expect(ActivityLabel.tool("apply_patch", input: [:]) == "Edit files")
    }

    @Test func interruptIdlesAndDropsAlerts() {
        var store = SessionStore()
        store.apply(event(.preToolUse, agent: "codex", tool: "Bash"), at: now)
        store.apply(HookEvent(kind: .interrupt, sessionID: "s", agent: "codex"), at: now + 1)
        #expect(store.sessions.first?.state == .idle)

        var queue = AlertQueue()
        queue.add(PendingAlert.make(from: event(.permissionRequest, agent: "codex", tool: "Bash"), id: UUID(), at: now)!)
        #expect(queue.obsoleted(by: HookEvent(kind: .interrupt, sessionID: "s", agent: "codex")).count == 1)
    }

    @Test func interruptIsParsed() throws {
        let event = try #require(HookEvent.parse(Data(#"{"hook_event_name":"Interrupt","session_id":"s","motes_agent":"codex"}"#.utf8)))
        #expect(event.kind == .interrupt)
        #expect(event.agent == "codex")
    }
}
