import Foundation
import Testing
@testable import Motes

struct DiffEngineTests {
    let now = Date(timeIntervalSinceReferenceDate: 0)

    func input(_ object: [String: Any]) -> Data { try! JSONSerialization.data(withJSONObject: object) }

    @Test func editDiffsOldAgainstNew() throws {
        let changes = DiffEngine.changes(tool: "Edit", input: input([
            "file_path": "/repo/App.swift",
            "old_string": "let a = 1\nlet b = 2\nlet c = 3",
            "new_string": "let a = 1\nlet b = 20\nlet c = 3\nlet d = 4",
        ]), at: now)
        let change = try #require(changes.first)
        #expect(changes.count == 1)
        #expect(change.fileName == "App.swift")
        #expect(change.added == 2 && change.removed == 1)
        let kinds = try #require(change.lines).map(\.kind)
        #expect(kinds.contains(.added) && kinds.contains(.removed) && kinds.contains(.context))
    }

    @Test func multiEditSumsEveryEdit() throws {
        let change = try #require(DiffEngine.changes(tool: "MultiEdit", input: input([
            "file_path": "/repo/a.txt",
            "edits": [["old_string": "x", "new_string": "y"], ["old_string": "", "new_string": "z\nw"]],
        ]), at: now).first)
        #expect(change.added == 3 && change.removed == 1)
        // Edits are separated by a gap.
        #expect(try #require(change.lines).contains { $0.kind == .gap })
    }

    @Test func writeCountsEverythingAsAdded() throws {
        let change = try #require(DiffEngine.changes(tool: "Write", input: input([
            "file_path": "/repo/new.md", "content": "one\ntwo\nthree\n",
        ]), at: now).first)
        #expect(change.added == 3 && change.removed == 0)
    }

    @Test func codexPatchGivesOneChangePerFile() throws {
        let patch = """
        *** Begin Patch
        *** Update File: src/main.rs
        @@ fn main
         let x = 1;
        -let y = 2;
        +let y = 3;
        *** Add File: src/new.rs
        +pub fn hi() {}
        +
        *** Delete File: src/old.rs
        *** End Patch
        """
        let changes = DiffEngine.changes(tool: "apply_patch", input: input(["command": patch]), at: now)
        #expect(changes.map(\.path) == ["src/main.rs", "src/new.rs", "src/old.rs"])
        #expect(changes[0].added == 1 && changes[0].removed == 1)
        #expect(changes[0].lines?.map(\.kind) == [.context, .removed, .added])
        #expect(changes[1].added == 2)
        #expect(changes[2].added == 0 && changes[2].removed == 0)
    }

    @Test func otherToolsHaveNoChanges() {
        #expect(DiffEngine.changes(tool: "Bash", input: input(["command": "ls"]), at: now).isEmpty)
        #expect(DiffEngine.changes(tool: "Edit", input: nil, at: now).isEmpty)
        #expect(DiffEngine.changes(tool: "Edit", input: input(["old_string": "a"]), at: now).isEmpty)
    }

    @Test func longUnchangedRunsBecomeAGap() {
        let old = (1...30).map { "line \($0)" }
        var new = old
        new[2] = "changed early"
        new[25] = "changed late"
        let lines = DiffEngine.trimmed(LineDiff.diff(old, new))
        #expect(lines.filter { $0.kind == .gap }.count == 1)
        // Only context near the changes is kept.
        #expect(!lines.contains { $0.text == "line 15" })
        #expect(lines.contains { $0.text == "line 24" })
    }

    @Test func noChangeNoLines() {
        #expect(DiffEngine.trimmed(LineDiff.diff(["a", "b"], ["a", "b"])).isEmpty)
    }

    @Test func tooLargeKeepsOnlyCounts() throws {
        let big = String(repeating: "x\n", count: DiffEngine.maxLines + 10)
        let change = try #require(DiffEngine.changes(tool: "Write", input: input([
            "file_path": "/repo/big.txt", "content": big,
        ]), at: now).first)
        #expect(change.lines == nil)
        #expect(change.added == DiffEngine.maxLines + 10)
    }

    @Test func lineSplitting() {
        #expect(DiffEngine.lines("") == [])
        #expect(DiffEngine.lines("a\nb\n") == ["a", "b"])
        #expect(DiffEngine.lines("a\n\nb") == ["a", "", "b"])
    }
}

struct SessionEditsTests {
    let now = Date(timeIntervalSinceReferenceDate: 0)

    func post(_ tool: String, _ input: [String: Any]) -> HookEvent {
        var event = HookEvent(kind: .postToolUse, sessionID: "s", agent: "claude")
        event.toolName = tool
        event.rawToolInput = try? JSONSerialization.data(withJSONObject: input)
        return event
    }

    @Test func editIsRecordedAndShownWithTheFeedLine() throws {
        var store = SessionStore()
        var pre = HookEvent(kind: .preToolUse, sessionID: "s", agent: "claude")
        pre.toolName = "Edit"
        pre.toolInput = ["file_path": "/repo/App.swift"]
        store.apply(pre, at: now)
        store.apply(post("Edit", ["file_path": "/repo/App.swift", "old_string": "a", "new_string": "b"]), at: now + 1)
        let session = try #require(store.sessions.first)
        #expect(session.latestActivity == "Edit App.swift")
        #expect(session.latestChange?.added == 1)
        #expect(session.changes.count == 1)
    }

    @Test func nextActionHidesTheCountsButKeepsTheEdit() {
        var store = SessionStore()
        store.apply(post("Write", ["file_path": "/repo/a.md", "content": "x"]), at: now)
        var bash = HookEvent(kind: .preToolUse, sessionID: "s", agent: "claude")
        bash.toolName = "Bash"
        store.apply(bash, at: now + 1)
        #expect(store.sessions.first?.latestChange == nil)
        #expect(store.sessions.first?.changes.count == 1)
    }

    @Test func editsAreCapped() {
        var store = SessionStore()
        for index in 0..<(AgentSession.maxChanges + 5) {
            store.apply(post("Write", ["file_path": "/repo/\(index).md", "content": "x"]), at: now + Double(index))
        }
        let changes = store.sessions.first?.changes ?? []
        #expect(changes.count == AgentSession.maxChanges)
        #expect(changes.last?.path == "/repo/\(AgentSession.maxChanges + 4).md")
    }

    @Test func endedSessionsTakeTheirEditsAway() {
        var store = SessionStore()
        store.apply(post("Write", ["file_path": "/repo/a.md", "content": "x"]), at: now)
        store.apply(HookEvent(kind: .sessionEnd, sessionID: "s", agent: "claude"), at: now + 1)
        #expect(store.sessions.isEmpty)
    }
}
