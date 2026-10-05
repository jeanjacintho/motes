import Foundation

/// Short, human labels for the activity feed.
enum ActivityLabel {
    static let maxLength = 60

    /// "Edit Invoice.swift", "Bash npm test", "Grep \"TODO\"", "WebFetch docs.swift.org"…
    static func tool(_ name: String, input: [String: String]) -> String {
        let label: String
        switch name {
        case "Edit", "MultiEdit", "Write", "Read":
            label = join(name, input["file_path"].map(fileName))
        case "NotebookEdit", "NotebookRead":
            label = join(name, input["notebook_path"].map(fileName))
        case "Bash":
            label = join(name, input["command"].map(firstLine))
        case "apply_patch":
            // Codex edits files with a patch: name the files instead of showing it.
            let files = input["command"].map(patchFiles) ?? []
            if let first = files.first {
                let more = files.count > 1 ? " +\(files.count - 1)" : ""
                label = "\(first.verb) \(fileName(first.path))\(more)"
            } else {
                label = "Edit files"
            }
        case "Grep":
            label = join(name, input["pattern"].map { "\"\($0)\"" })
        case "Glob":
            label = join(name, input["pattern"])
        case "WebFetch":
            label = join(name, input["url"].flatMap { URL(string: $0)?.host() })
        case "WebSearch":
            label = join(name, input["query"])
        case "Task", "Agent":
            label = join(name, input["description"])
        default:
            if name.hasPrefix("mcp__") {
                // mcp__server__tool → "server: tool"
                let parts = name.split(separator: "_", omittingEmptySubsequences: true)
                label = parts.count >= 3 ? "\(parts[1]): \(parts[2...].joined(separator: "_"))" : name
            } else {
                label = name
            }
        }
        return truncate(label)
    }

    /// Files a Codex patch touches, from its `*** Add/Update/Delete File:` headers.
    static func patchFiles(_ patch: String) -> [(verb: String, path: String)] {
        let headers = [("*** Add File: ", "Write"), ("*** Update File: ", "Edit"), ("*** Delete File: ", "Delete")]
        return patch.split(whereSeparator: \.isNewline).compactMap { line in
            for (prefix, verb) in headers where line.hasPrefix(prefix) {
                let path = line.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces)
                return path.isEmpty ? nil : (verb, path)
            }
            return nil
        }
    }

    /// "› Fix the login bug" from a prompt.
    static func prompt(_ text: String) -> String {
        truncate("› " + firstLine(text))
    }

    /// First useful line of an assistant message, without Markdown markers.
    static func summary(_ text: String) -> String? {
        let line = text.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "#*>-` ")) }
            .first { !$0.isEmpty }
        return line.map(truncate)
    }

    static func truncate(_ text: String) -> String {
        text.count > maxLength ? String(text.prefix(maxLength - 1)) + "…" : text
    }

    private static func join(_ name: String, _ detail: String?) -> String {
        guard let detail, !detail.isEmpty else { return name }
        return "\(name) \(detail)"
    }

    private static func fileName(_ path: String) -> String {
        (path as NSString).lastPathComponent
    }

    private static func firstLine(_ text: String) -> String {
        text.split(whereSeparator: \.isNewline).first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
    }
}
