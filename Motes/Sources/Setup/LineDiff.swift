/// Minimal line diff to show the user what will change before writing a file.
enum LineDiff {
    enum Line: Equatable {
        case same(String)
        case added(String)
        case removed(String)
    }

    static func diff(_ old: [String], _ new: [String]) -> [Line] {
        // Longest common subsequence table, from the end.
        let n = old.count, m = new.count
        var lcs = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)
        for i in stride(from: n - 1, through: 0, by: -1) {
            for j in stride(from: m - 1, through: 0, by: -1) {
                lcs[i][j] = old[i] == new[j] ? lcs[i + 1][j + 1] + 1 : max(lcs[i + 1][j], lcs[i][j + 1])
            }
        }
        var lines: [Line] = []
        var i = 0, j = 0
        while i < n || j < m {
            if i < n, j < m, old[i] == new[j] {
                lines.append(.same(old[i])); i += 1; j += 1
            } else if j < m, i == n || lcs[i][j + 1] >= lcs[i + 1][j] {
                lines.append(.added(new[j])); j += 1
            } else {
                lines.append(.removed(old[i])); i += 1
            }
        }
        return lines
    }

    /// "+ " / "- " / "  " prefixed text, with long unchanged runs folded.
    static func render(_ lines: [Line], context: Int = 2) -> String {
        var output: [String] = []
        var index = 0
        while index < lines.count {
            guard case .same = lines[index] else {
                switch lines[index] {
                case .added(let text): output.append("+ " + text)
                case .removed(let text): output.append("- " + text)
                case .same: break
                }
                index += 1
                continue
            }
            var end = index
            while end < lines.count, case .same = lines[end] { end += 1 }
            let run = lines[index..<end].map { line -> String in
                if case .same(let text) = line { return "  " + text } else { return "" }
            }
            let atStart = index == 0, atEnd = end == lines.count
            let head = atStart ? 0 : context, tail = atEnd ? 0 : context
            if run.count > head + tail + 1 {
                output.append(contentsOf: run.prefix(head))
                output.append("  …")
                output.append(contentsOf: run.suffix(tail))
            } else {
                output.append(contentsOf: run)
            }
            index = end
        }
        return output.joined(separator: "\n")
    }
}
