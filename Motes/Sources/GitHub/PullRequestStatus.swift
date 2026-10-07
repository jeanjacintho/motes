import Foundation

/// The open pull request of a session's branch, with its checks and reviews.
struct PullRequestStatus: Equatable, Sendable {
    enum CI: Equatable, Sendable { case none, pending, success, failure }
    enum Review: Equatable, Sendable { case none, approved, changesRequested }

    let number: Int
    let title: String
    let url: URL
    let isDraft: Bool
    var ci: CI = .none
    var review: Review = .none
}

/// Reads GitHub REST API responses. Pure.
enum GitHubParse {
    struct PullRequest: Equatable {
        let status: PullRequestStatus
        let headSHA: String
    }

    /// First pull request of a `GET /repos/{o}/{r}/pulls` list.
    static func pullRequest(_ data: Data) -> PullRequest? {
        guard let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]],
              let pull = list.first,
              let number = pull["number"] as? Int,
              let link = (pull["html_url"] as? String).flatMap(URL.init(string:)),
              link.scheme == "https", link.host == "github.com",
              let sha = (pull["head"] as? [String: Any])?["sha"] as? String, isSHA(sha)
        else { return nil }
        let status = PullRequestStatus(
            number: number, title: pull["title"] as? String ?? "", url: link,
            isDraft: pull["draft"] as? Bool ?? false
        )
        return PullRequest(status: status, headSHA: sha)
    }

    /// Check runs (`/commits/{sha}/check-runs`) and commit statuses
    /// (`/commits/{sha}/status`) together: any failure fails, anything still
    /// running is pending, all green succeeds.
    static func ci(checkRuns: Data?, combinedStatus: Data?) -> PullRequestStatus.CI {
        var states: [PullRequestStatus.CI] = []
        if let data = checkRuns,
           let runs = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["check_runs"] as? [[String: Any]] {
            for run in runs {
                guard run["status"] as? String == "completed" else { states.append(.pending); continue }
                switch run["conclusion"] as? String {
                case "success", "neutral", "skipped": states.append(.success)
                default: states.append(.failure)
                }
            }
        }
        if let data = combinedStatus,
           let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           (object["total_count"] as? Int ?? 0) > 0 {
            switch object["state"] as? String {
            case "success": states.append(.success)
            case "pending": states.append(.pending)
            default: states.append(.failure)
            }
        }
        if states.contains(.failure) { return .failure }
        if states.contains(.pending) { return .pending }
        return states.isEmpty ? .none : .success
    }

    /// Each reviewer's latest decision (`/pulls/{n}/reviews`, oldest first);
    /// one request for changes outweighs approvals.
    static func review(_ data: Data?) -> PullRequestStatus.Review {
        guard let data, let reviews = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return .none }
        var latest: [String: String] = [:]
        for review in reviews {
            guard let login = (review["user"] as? [String: Any])?["login"] as? String,
                  let state = review["state"] as? String else { continue }
            switch state {
            case "APPROVED", "CHANGES_REQUESTED", "DISMISSED": latest[login] = state
            default: break // Comments don't change a reviewer's decision.
            }
        }
        if latest.values.contains("CHANGES_REQUESTED") { return .changesRequested }
        if latest.values.contains("APPROVED") { return .approved }
        return .none
    }

    static func isSHA(_ value: String) -> Bool {
        (7...64).contains(value.count) && value.allSatisfy(\.isHexDigit)
    }
}
