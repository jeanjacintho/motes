import Foundation
import Testing
@testable import Motes

struct MoteFormTests {
    @Test func fiveFormsAndNineColors() {
        #expect(MoteForm.allCases.count == 5)
        #expect(MotePalette.allCases.count == 9)
    }

    @Test func colorsAreDistinct() {
        let colors = MotePalette.allCases.map { "\($0.color.r)-\($0.color.g)-\($0.color.b)" }
        #expect(Set(colors).count == colors.count)
    }

    @Test func formsLookDifferent() {
        let traits = MoteForm.allCases.map { "\($0.eyes)|\($0.orbit)" }
        #expect(Set(traits).count == traits.count)
    }

    @Test func personalityTakesTheFormAndTheColor() {
        let p = MotePersonality(id: "x", name: "Docs", form: .curious, color: .teal)
        #expect(p.eyes == MoteForm.curious.eyes)
        #expect(p.orbit == MoteForm.curious.orbit)
        #expect(p.color == MotePalette.teal.color)
        #expect(p.name == "Docs")
    }
}

struct MoteOwnerTests {
    let motes = [
        Mote(id: "a", name: "Code", folder: "/Users/me/code", form: .calm, color: .blue, cli: .claude),
        Mote(id: "b", name: "App", folder: "/Users/me/code/app/", form: .calm, color: .pink, cli: .claude),
    ]

    @Test func exactFolder() {
        #expect(Mote.owner(of: "/Users/me/code/app", in: motes)?.id == "b")
    }

    @Test func deepestFolderWins() {
        #expect(Mote.owner(of: "/Users/me/code/app/Sources/UI", in: motes)?.id == "b")
        #expect(Mote.owner(of: "/Users/me/code/web", in: motes)?.id == "a")
    }

    @Test func siblingWithSamePrefixDoesNotMatch() {
        #expect(Mote.owner(of: "/Users/me/code/application", in: motes)?.id == "a")
        #expect(Mote.owner(of: "/Users/me/codex", in: motes) == nil)
    }

    @Test func noMatch() {
        #expect(Mote.owner(of: "/tmp", in: motes) == nil)
        #expect(Mote.owner(of: "/Users/me/code", in: []) == nil)
    }
}

struct MoteBridgeTests {
    let moteID = "6f1c2a9e-1b2c-4d5e-8f90-123456789abc"

    @Test func relayForwardsTheMoteFromTheEnvironment() throws {
        let data = try #require(HookRelay.message(
            payload: Data(#"{"hook_event_name":"Stop","session_id":"s"}"#.utf8),
            agent: nil, eventName: nil, environment: ["MOTES_MOTE_ID": moteID]
        ))
        let event = try #require(HookEvent.parse(data.dropLast()))
        #expect(event.moteID == moteID)
    }

    @Test func invalidMoteIDsAreDropped() throws {
        for bad in ["", "UPPER", "a b", String(repeating: "a", count: 41), "../etc"] {
            let data = try #require(HookRelay.message(
                payload: Data(#"{"hook_event_name":"Stop","session_id":"s"}"#.utf8),
                agent: nil, eventName: nil, environment: ["MOTES_MOTE_ID": bad]
            ))
            #expect(HookEvent.parse(data.dropLast())?.moteID == nil, "\(bad)")
        }
    }

    @Test func sessionKeepsItsMote() {
        var store = SessionStore()
        var start = HookEvent(kind: .sessionStart, sessionID: "s", agent: "claude")
        start.moteID = moteID
        store.apply(start, at: .now)
        // Later events without the mote don't unlink it.
        store.apply(HookEvent(kind: .preToolUse, sessionID: "s", agent: "claude"), at: .now)
        #expect(store.sessions.first?.moteID == moteID)
    }
}

struct MoteLauncherTests {
    let mote = Mote(id: "6f1c2a9e-1b2c-4d5e-8f90-123456789abc", name: "Bob's app",
                    folder: "/Users/me/My Projects/it's here", form: .calm, color: .coral, cli: .claude)

    @Test func scriptEntersTheFolderAndTiesTheMote() {
        let script = MoteLauncher.script(for: mote)
        #expect(script.hasPrefix("#!/bin/sh\n"))
        #expect(script.contains("cd -- '/Users/me/My Projects/it'\\''s here' || exit 1"))
        #expect(script.contains("export MOTES_MOTE_ID='6f1c2a9e-1b2c-4d5e-8f90-123456789abc'"))
        #expect(script.contains("claude; exec \"$SHELL\" -i -l"))
    }

    @Test func scriptIsValidShell() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID()).command")
        try MoteLauncher.script(for: mote).write(to: url, atomically: true, encoding: .utf8)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-n", url.path]
        try process.run()
        process.waitUntilExit()
        #expect(process.terminationStatus == 0)
    }

    @Test func quoting() {
        #expect(MoteLauncher.shellQuoted("plain") == "'plain'")
        #expect(MoteLauncher.shellQuoted("it's") == "'it'\\''s'")
        #expect(MoteLauncher.shellQuoted("$(rm -rf ~)") == "'$(rm -rf ~)'")
    }
}

@MainActor
struct MoteLibraryTests {
    func temporaryFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID())/motes.json")
    }

    @Test func savesAndLoads() {
        let url = temporaryFile()
        let library = MoteLibrary(fileURL: url)
        #expect(library.motes.isEmpty)
        let mote = Mote(name: "Docs", folder: "/tmp", form: .bubbly, color: .yellow, cli: .codex)
        library.add(mote)

        let reloaded = MoteLibrary(fileURL: url)
        #expect(reloaded.motes.count == 1)
        #expect(reloaded.motes.first?.id == mote.id)
        #expect(reloaded.motes.first?.form == .bubbly)
        #expect(reloaded.motes.first?.cli == .codex)

        reloaded.remove(id: mote.id)
        #expect(MoteLibrary(fileURL: url).motes.isEmpty)
    }

    @Test func brokenFileIsNotOverwrittenOnLoad() throws {
        let url = temporaryFile()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{ broken".utf8).write(to: url)
        let library = MoteLibrary(fileURL: url)
        #expect(library.motes.isEmpty)
        #expect(library.lastError != nil)
        #expect(try String(contentsOf: url, encoding: .utf8) == "{ broken")
    }

    @Test func newIDsAreValidForTheBridge() {
        #expect(BridgeProtocol.isValidMoteID(Mote.newID()))
    }
}
