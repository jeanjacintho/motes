import Foundation
import Observation
import os

/// When to ask GitHub again. Pure.
enum GitHubPolling {
    /// While some checks are still running.
    static let active: TimeInterval = 30
    static let idle: TimeInterval = 120
    /// After a rate limit, or without a token (gh may log in later).
    static let backoff: TimeInterval = 600
    /// After an agent's turn ends: it may have pushed or opened a PR.
    static let afterTurn: TimeInterval = 3

    static func interval(for statuses: some Collection<PullRequestStatus>) -> TimeInterval {
        statuses.contains { $0.ci == .pending } ? active : idle
    }

    /// A session appeared, or one just finished a turn.
    static func needsRefresh(old: [AgentSession], new: [AgentSession]) -> Bool {
        let before = Dictionary(old.map { ($0.id, $0.state) }, uniquingKeysWith: { a, _ in a })
        return new.contains { session in
            guard let state = before[session.id] else { return session.cwd != nil }
            return session.state == .finished && state != .finished
        }
    }
}

/// Keeps the open pull request of each session's branch, with its checks and
/// reviews. Asks GitHub only while it's turned on and sessions are running.
@MainActor
@Observable
final class GitHubMonitor {
    enum Connection: Equatable {
        case off
        case connecting
        case connected(GitHubToken.Source)
        case noToken
        case failed(String)
    }

    private(set) var connection: Connection = .off
    private(set) var isEnabled = false

    /// Pull requests by session ID.
    @ObservationIgnored var onChange: (([String: PullRequestStatus]) -> Void)?

    @ObservationIgnored private var sessions: [AgentSession] = []
    @ObservationIgnored private var token: (token: String, source: GitHubToken.Source)?
    @ObservationIgnored private var known: [BranchRef: PullRequestStatus] = [:]
    @ObservationIgnored private var published: [String: PullRequestStatus] = [:]
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private let client = GitHubClient()
    @ObservationIgnored private let log = Logger(subsystem: "app.motes", category: "github")

    func setEnabled(_ enabled: Bool) {
        isEnabled = enabled
        token = nil
        if enabled {
            connection = .connecting
            refresh(after: 0)
        } else {
            task?.cancel()
            connection = .off
            known = [:]
            publish([:])
        }
    }

    /// The pasted token changed: ask for it again.
    func tokenChanged() {
        token = nil
        if isEnabled { refresh(after: 0) }
    }

    func update(sessions: [AgentSession]) {
        let needsRefresh = GitHubPolling.needsRefresh(old: self.sessions, new: sessions)
        self.sessions = sessions
        guard isEnabled else { return }
        if sessions.isEmpty {
            task?.cancel()
            publish([:])
        } else if needsRefresh || task == nil {
            refresh(after: GitHubPolling.afterTurn)
        }
    }

    // MARK: - Polling

    private func refresh(after delay: TimeInterval) {
        task?.cancel()
        task = Task { [weak self] in
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            guard !Task.isCancelled else { return }
            await self?.poll()
        }
    }

    private func poll() async {
        guard isEnabled, !sessions.isEmpty else { task = nil; return }
        if token == nil {
            token = await GitHubToken.load()
            guard !Task.isCancelled else { return }
        }
        guard let token else {
            connection = .noToken
            return schedule(GitHubPolling.backoff)
        }
        connection = .connected(token.source)

        let folders = sessions.reduce(into: [String: String]()) { result, session in
            if let cwd = session.cwd { result[session.id] = cwd }
        }
        let refs = await Task.detached { folders.compactMapValues { GitCheckout.branchRef(for: $0) } }.value

        var fresh: [BranchRef: PullRequestStatus] = [:]
        for ref in Set(refs.values) {
            do {
                fresh[ref] = try await client.status(of: ref, token: token.token)
            } catch GitHubClient.Failure.unauthorized {
                self.token = nil
                connection = .failed(token.source == .keychain
                    ? "GitHub refused the saved token. Paste a new one."
                    : "GitHub refused the gh CLI's login. Run gh auth login.")
                return schedule(GitHubPolling.backoff)
            } catch GitHubClient.Failure.rateLimited {
                connection = .failed("GitHub's rate limit was reached. Motes tries again in 10 minutes.")
                return schedule(GitHubPolling.backoff)
            } catch {
                guard !Task.isCancelled else { return }
                // Offline or a hiccup: keep what was known.
                log.debug("GitHub: \(String(describing: error), privacy: .public)")
                fresh[ref] = known[ref]
            }
        }
        guard !Task.isCancelled else { return }
        known = fresh
        publish(refs.compactMapValues { fresh[$0] })
        schedule(GitHubPolling.interval(for: fresh.values))
    }

    private func schedule(_ delay: TimeInterval) {
        refresh(after: delay)
    }

    private func publish(_ statuses: [String: PullRequestStatus]) {
        guard statuses != published else { return }
        published = statuses
        onChange?(statuses)
    }
}
