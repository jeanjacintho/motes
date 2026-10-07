import Foundation

/// A GitHub repository, `owner/name`.
struct GitHubRepo: Hashable, Sendable {
    let owner: String
    let name: String

    var slug: String { "\(owner)/\(name)" }

    /// Reads a github.com remote URL: `git@github.com:o/r.git`,
    /// `https://github.com/o/r`, `ssh://git@github.com/o/r.git`…
    static func parse(remote: String) -> GitHubRepo? {
        let remote = remote.trimmingCharacters(in: .whitespacesAndNewlines)
        let host: String
        let path: String
        if remote.contains("://") {
            guard let url = URL(string: remote), let urlHost = url.host else { return nil }
            host = urlHost
            path = url.path
        } else {
            // scp-like: [user@]host:path
            guard let colon = remote.firstIndex(of: ":") else { return nil }
            host = String(remote[..<colon].split(separator: "@").last ?? "")
            path = String(remote[remote.index(after: colon)...])
        }
        guard host.lowercased() == "github.com" else { return nil }
        var trimmed = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if trimmed.hasSuffix(".git") { trimmed.removeLast(4) }
        let parts = trimmed.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 2, parts.allSatisfy(isValidComponent) else { return nil }
        return GitHubRepo(owner: parts[0], name: parts[1])
    }

    private static func isValidComponent(_ value: String) -> Bool {
        guard (1...100).contains(value.count), value != ".", value != ".." else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            CharacterSet.alphanumerics.contains(scalar) && scalar.isASCII || "._-".unicodeScalars.contains(scalar)
        }
    }
}

/// The branch a folder is on, in a GitHub repository.
struct BranchRef: Hashable, Sendable {
    let repo: GitHubRepo
    let branch: String
}

/// Finds a folder's repository and branch by reading `.git` directly: no git
/// process, no network. Pure apart from the injected file reader.
enum GitCheckout {
    typealias Reader = @Sendable (String) -> String?

    static let readFile: Reader = { path in try? String(contentsOfFile: path, encoding: .utf8) }

    static func branchRef(for folder: String, read: Reader = readFile) -> BranchRef? {
        guard let dirs = gitDirectories(from: folder, read: read),
              let head = read(dirs.gitDir + "/HEAD"), let branch = branch(head: head),
              let config = read(dirs.commonDir + "/config"), let url = originURL(config: config),
              let repo = GitHubRepo.parse(remote: url) else { return nil }
        return BranchRef(repo: repo, branch: branch)
    }

    /// The git directory (per worktree: `HEAD`) and the common one (`config`),
    /// looking in `folder` and its parents.
    static func gitDirectories(from folder: String, read: Reader) -> (gitDir: String, commonDir: String)? {
        var current = (folder as NSString).standardizingPath
        while !current.isEmpty {
            let dotGit = current + "/.git"
            if read(dotGit + "/HEAD") != nil {
                return (dotGit, dotGit)
            }
            // A worktree or submodule: `.git` is a file pointing to the real directory.
            if let file = read(dotGit), file.hasPrefix("gitdir:") {
                let target = file.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespacesAndNewlines)
                let gitDir = resolve(target, against: current)
                let common = read(gitDir + "/commondir")
                    .map { resolve($0.trimmingCharacters(in: .whitespacesAndNewlines), against: gitDir) } ?? gitDir
                return (gitDir, common)
            }
            if current == "/" { break }
            current = (current as NSString).deletingLastPathComponent
        }
        return nil
    }

    /// `ref: refs/heads/main` → `main`; `nil` when detached.
    static func branch(head: String) -> String? {
        let line = head.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = "ref: refs/heads/"
        guard line.hasPrefix(prefix) else { return nil }
        let branch = String(line.dropFirst(prefix.count))
        return branch.isEmpty ? nil : branch
    }

    /// `url` of `[remote "origin"]` in a git config.
    static func originURL(config: String) -> String? {
        var inOrigin = false
        for raw in config.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("[") {
                inOrigin = line.replacingOccurrences(of: " ", with: "") == "[remote\"origin\"]"
                continue
            }
            guard inOrigin, let equals = line.firstIndex(of: "=") else { continue }
            let key = line[..<equals].trimmingCharacters(in: .whitespaces)
            if key == "url" {
                return line[line.index(after: equals)...].trimmingCharacters(in: .whitespaces)
            }
        }
        return nil
    }

    private static func resolve(_ path: String, against base: String) -> String {
        let full = path.hasPrefix("/") ? path : base + "/" + path
        return (full as NSString).standardizingPath
    }
}
