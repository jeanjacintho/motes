import Foundation
import Testing
@testable import Motes

struct GitHubRepoTests {
    @Test(arguments: [
        "git@github.com:jeanjacintho/motes.git",
        "https://github.com/jeanjacintho/motes",
        "https://github.com/jeanjacintho/motes.git",
        "https://token@github.com/jeanjacintho/motes.git/",
        "ssh://git@github.com/jeanjacintho/motes.git",
        "  git@GitHub.com:jeanjacintho/motes.git\n",
    ])
    func parsesGitHubRemotes(remote: String) {
        #expect(GitHubRepo.parse(remote: remote) == GitHubRepo(owner: "jeanjacintho", name: "motes"))
    }

    @Test(arguments: [
        "git@gitlab.com:a/b.git",
        "https://github.com/a",
        "https://github.com/a/b/c",
        "https://github.com/a/../b",
        "https://github.com/a b/c",
        "/local/path/repo",
        "",
    ])
    func rejectsOtherRemotes(remote: String) {
        #expect(GitHubRepo.parse(remote: remote) == nil)
    }
}

struct GitCheckoutTests {
    func reader(_ files: [String: String]) -> GitCheckout.Reader {
        { files[$0] }
    }

    let config = """
    [core]
    \tbare = false
    [remote "upstream"]
    \turl = git@github.com:other/motes.git
    [remote "origin"]
    \turl = git@github.com:jeanjacintho/motes.git
    \tfetch = +refs/heads/*:refs/remotes/origin/*
    [branch "main"]
    \tremote = origin
    """

    @Test func readsBranchAndOriginFromAParentFolder() {
        let read = reader([
            "/code/motes/.git/HEAD": "ref: refs/heads/feature/usage\n",
            "/code/motes/.git/config": config,
        ])
        let ref = GitCheckout.branchRef(for: "/code/motes/Motes/Sources", read: read)
        #expect(ref == BranchRef(repo: GitHubRepo(owner: "jeanjacintho", name: "motes"), branch: "feature/usage"))
    }

    @Test func followsWorktrees() {
        let read = reader([
            "/code/wt/.git": "gitdir: /code/motes/.git/worktrees/wt\n",
            "/code/motes/.git/worktrees/wt/HEAD": "ref: refs/heads/fix\n",
            "/code/motes/.git/worktrees/wt/commondir": "../..\n",
            "/code/motes/.git/config": config,
        ])
        #expect(GitCheckout.branchRef(for: "/code/wt", read: read)?.branch == "fix")
    }

    @Test func detachedHeadsAndOtherHostsHaveNoBranch() {
        #expect(GitCheckout.branch(head: "3f2c9e1d4b5a6c7d8e9f0a1b2c3d4e5f6a7b8c9d\n") == nil)
        let read = reader([
            "/code/x/.git/HEAD": "ref: refs/heads/main",
            "/code/x/.git/config": "[remote \"origin\"]\n\turl = git@gitlab.com:a/b.git\n",
        ])
        #expect(GitCheckout.branchRef(for: "/code/x", read: read) == nil)
        #expect(GitCheckout.branchRef(for: "/nowhere", read: reader([:])) == nil)
    }

    @Test func readsOnlyTheOriginURL() {
        #expect(GitCheckout.originURL(config: config) == "git@github.com:jeanjacintho/motes.git")
        #expect(GitCheckout.originURL(config: "[remote \"upstream\"]\n\turl = x\n") == nil)
    }
}

struct GitHubParseTests {
    func data(_ object: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: object)
    }

    @Test func readsTheFirstPullRequest() throws {
        let list: [[String: Any]] = [[
            "number": 42, "title": "Add usage", "html_url": "https://github.com/a/b/pull/42",
            "draft": true, "head": ["sha": "abc1234def"],
        ]]
        let pull = try #require(GitHubParse.pullRequest(try data(list)))
        #expect(pull.status.number == 42)
        #expect(pull.status.title == "Add usage")
        #expect(pull.status.isDraft)
        #expect(pull.headSHA == "abc1234def")
        #expect(GitHubParse.pullRequest(try data([Any]())) == nil)
    }

    @Test func rejectsLinksOutsideGitHub() throws {
        let list: [[String: Any]] = [[
            "number": 1, "html_url": "https://evil.example/pull/1", "head": ["sha": "abc1234"],
        ]]
        #expect(GitHubParse.pullRequest(try data(list)) == nil)
    }

    func runs(_ runs: [(String, String?)]) throws -> Data {
        try data(["check_runs": runs.map { status, conclusion in
            ["status": status, "conclusion": conclusion ?? NSNull()] as [String: Any]
        }])
    }

    @Test func summarizesChecks() throws {
        #expect(GitHubParse.ci(checkRuns: nil, combinedStatus: nil) == .none)
        #expect(GitHubParse.ci(checkRuns: try runs([("completed", "success"), ("completed", "skipped")]), combinedStatus: nil) == .success)
        #expect(GitHubParse.ci(checkRuns: try runs([("completed", "success"), ("in_progress", nil)]), combinedStatus: nil) == .pending)
        #expect(GitHubParse.ci(checkRuns: try runs([("in_progress", nil), ("completed", "failure")]), combinedStatus: nil) == .failure)
    }

    @Test func emptyCombinedStatusesDontCountAsPending() throws {
        let none = try data(["state": "pending", "total_count": 0])
        #expect(GitHubParse.ci(checkRuns: try runs([("completed", "success")]), combinedStatus: none) == .success)
        let failing = try data(["state": "error", "total_count": 1])
        #expect(GitHubParse.ci(checkRuns: try runs([("completed", "success")]), combinedStatus: failing) == .failure)
    }

    @Test func keepsEachReviewersLatestDecision() throws {
        func review(_ login: String, _ state: String) -> [String: Any] { ["user": ["login": login], "state": state] }
        #expect(GitHubParse.review(nil) == .none)
        #expect(GitHubParse.review(try data([review("a", "COMMENTED")])) == .none)
        #expect(GitHubParse.review(try data([review("a", "CHANGES_REQUESTED"), review("a", "APPROVED")])) == .approved)
        #expect(GitHubParse.review(try data([review("a", "APPROVED"), review("a", "COMMENTED")])) == .approved)
        #expect(GitHubParse.review(try data([review("a", "APPROVED"), review("b", "CHANGES_REQUESTED")])) == .changesRequested)
        #expect(GitHubParse.review(try data([review("a", "APPROVED"), review("a", "DISMISSED")])) == .none)
    }
}

struct GitHubPollingTests {
    func session(_ id: String, _ state: MoteState, cwd: String? = "/code") -> AgentSession {
        AgentSession(id: id, agent: "claude", name: id, cwd: cwd, state: state,
                     startedAt: .now, lastEventAt: .now, stateChangedAt: .now)
    }

    func pull(_ ci: PullRequestStatus.CI) -> PullRequestStatus {
        PullRequestStatus(number: 1, title: "", url: URL(string: "https://github.com/a/b/pull/1")!, isDraft: false, ci: ci)
    }

    @Test func pollsFasterWhileChecksRun() {
        #expect(GitHubPolling.interval(for: [PullRequestStatus]()) == GitHubPolling.idle)
        #expect(GitHubPolling.interval(for: [pull(.success), pull(.failure)]) == GitHubPolling.idle)
        #expect(GitHubPolling.interval(for: [pull(.success), pull(.pending)]) == GitHubPolling.active)
    }

    @Test func refreshesOnNewSessionsAndFinishedTurns() {
        let working = [session("a", .working)]
        #expect(GitHubPolling.needsRefresh(old: [], new: working))
        #expect(!GitHubPolling.needsRefresh(old: [], new: [session("a", .idle, cwd: nil)]))
        #expect(!GitHubPolling.needsRefresh(old: working, new: [session("a", .thinking)]))
        #expect(GitHubPolling.needsRefresh(old: working, new: [session("a", .finished)]))
        #expect(!GitHubPolling.needsRefresh(old: [session("a", .finished)], new: [session("a", .finished)]))
    }
}
