import Foundation

/// One file edit made by an agent, as shown in the island.
struct FileChange: Identifiable, Equatable, Sendable {
    let id: UUID
    let path: String
    let added: Int
    let removed: Int
    /// Changed lines with a little context; `nil` when the edit was too large to show.
    let lines: [Line]?
    let at: Date

    struct Line: Equatable, Sendable {
        enum Kind: Equatable, Sendable { case context, added, removed, gap }
        let kind: Kind
        let text: String
    }

    var fileName: String { (path as NSString).lastPathComponent }
}

/// Builds `FileChange`s from what the agent's hook event carries. Never reads
/// files from disk: an `Edit` is diffed between its old and new text, a `Write`
/// counts as all added, a Codex patch is read hunk by hunk. Pure.
enum DiffEngine {
    /// Above this much text, only the counts are kept.
    static let maxBytes = 200_000
    static let maxLines = 4_000
    /// Unchanged lines kept around each change.
    static let context = 3

    /// Changes for a finished tool call, or none for tools that don't edit files.
    static func changes(tool: String, input: Data?, at date: Date) -> [FileChange] {
        guard let input,
              let object = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any] else { return [] }
        switch tool {
        case "Edit":
            guard let path = object["file_path"] as? String else { return [] }
            let pairs = [(object["old_string"] as? String ?? "", object["new_string"] as? String ?? "")]
            return [change(path: path, pairs: pairs, at: date)]
        case "MultiEdit":
            guard let path = object["file_path"] as? String,
                  let edits = object["edits"] as? [[String: Any]] else { return [] }
            let pairs = edits.map { ($0["old_string"] as? String ?? "", $0["new_string"] as? String ?? "") }
            return [change(path: path, pairs: pairs, at: date)]
        case "Write":
            guard let path = object["file_path"] as? String else { return [] }
            return [change(path: path, pairs: [("", object["content"] as? String ?? "")], at: date)]
        case "apply_patch":
            guard let patch = object["command"] as? String else { return [] }
            return patchChanges(patch, at: date)
        default:
            return []
        }
    }

    /// Diff of one or more old → new text pairs in the same file.
    static func change(path: String, pairs: [(String, String)], at date: Date) -> FileChange {
        let size = pairs.reduce(0) { $0 + $1.0.utf8.count + $1.1.utf8.count }
        let lineCount = pairs.reduce(0) { $0 + lines($1.0).count + lines($1.1).count }
        var added = 0, removed = 0
        var shown: [FileChange.Line] = []
        let tooLarge = size > maxBytes || lineCount > maxLines

        for (index, (old, new)) in pairs.enumerated() {
            if tooLarge {
                // Counting only: a cheap upper bound without the LCS table.
                added += lines(new).count
                removed += lines(old).count
                continue
            }
            let diff = LineDiff.diff(lines(old), lines(new))
            for line in diff {
                if case .added = line { added += 1 }
                if case .removed = line { removed += 1 }
            }
            if index > 0, !shown.isEmpty { shown.append(.init(kind: .gap, text: "")) }
            shown += trimmed(diff)
        }
        return FileChange(id: UUID(), path: path, added: added, removed: removed,
                          lines: tooLarge ? nil : shown, at: date)
    }

    /// Keeps changed lines and `context` unchanged lines around them; longer
    /// unchanged runs become a gap.
    static func trimmed(_ diff: [LineDiff.Line]) -> [FileChange.Line] {
        let changed = diff.indices.filter { if case .same = diff[$0] { false } else { true } }
        guard !changed.isEmpty else { return [] }
        var keep = Set<Int>()
        for index in changed {
            for near in max(0, index - context)...min(diff.count - 1, index + context) { keep.insert(near) }
        }
        var result: [FileChange.Line] = []
        var previous: Int?
        for index in keep.sorted() {
            if let previous, index > previous + 1 { result.append(.init(kind: .gap, text: "")) }
            switch diff[index] {
            case .same(let text): result.append(.init(kind: .context, text: text))
            case .added(let text): result.append(.init(kind: .added, text: text))
            case .removed(let text): result.append(.init(kind: .removed, text: text))
            }
            previous = index
        }
        return result
    }

    /// One change per file of a Codex `apply_patch` (`*** Add/Update/Delete File:` sections).
    static func patchChanges(_ patch: String, at date: Date) -> [FileChange] {
        struct Section { var path: String; var lines: [FileChange.Line] = []; var added = 0; var removed = 0 }
        var sections: [Section] = []
        let headers = ["*** Add File: ", "*** Update File: ", "*** Delete File: "]
        for raw in patch.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if let header = headers.first(where: line.hasPrefix) {
                let path = line.dropFirst(header.count).trimmingCharacters(in: .whitespaces)
                sections.append(Section(path: path))
                continue
            }
            guard !sections.isEmpty, !line.hasPrefix("*** ") else { continue }
            var section = sections.removeLast()
            if line.hasPrefix("@@") {
                if !section.lines.isEmpty { section.lines.append(.init(kind: .gap, text: "")) }
            } else if line.hasPrefix("+") {
                section.added += 1
                section.lines.append(.init(kind: .added, text: String(line.dropFirst())))
            } else if line.hasPrefix("-") {
                section.removed += 1
                section.lines.append(.init(kind: .removed, text: String(line.dropFirst())))
            } else if line.hasPrefix(" ") {
                section.lines.append(.init(kind: .context, text: String(line.dropFirst())))
            }
            sections.append(section)
        }
        let tooLarge = patch.utf8.count > maxBytes
        return sections.map { section in
            FileChange(id: UUID(), path: section.path, added: section.added, removed: section.removed,
                       lines: tooLarge || section.lines.count > maxLines ? nil : section.lines, at: date)
        }
    }

    /// Text split into lines; empty text has no lines.
    static func lines(_ text: String) -> [String] {
        guard !text.isEmpty else { return [] }
        var result = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if result.last == "" { result.removeLast() }
        return result
    }
}
