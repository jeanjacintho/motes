import Foundation

/// Read-only calls to the GitHub REST API (api.github.com only).
struct GitHubClient: Sendable {
    enum Failure: Error, Equatable {
        case unauthorized
        case rateLimited
        case http(Int)
    }

    private static let base = URL(string: "https://api.github.com")!

    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        // GitHub sends max-age=60: polls must see fresh checks, not the cache.
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()

    /// The open pull request of a branch with its checks and reviews; `nil`
    /// when the branch has none.
    func status(of ref: BranchRef, token: String) async throws -> PullRequestStatus? {
        let repo = "repos/\(ref.repo.owner)/\(ref.repo.name)"
        let pulls = try await get("\(repo)/pulls", token: token, query: [
            URLQueryItem(name: "head", value: "\(ref.repo.owner):\(ref.branch)"),
            URLQueryItem(name: "state", value: "open"),
            URLQueryItem(name: "per_page", value: "1"),
        ])
        guard let pull = GitHubParse.pullRequest(pulls) else { return nil }

        async let checkRuns = try? get("\(repo)/commits/\(pull.headSHA)/check-runs", token: token,
                                        query: [URLQueryItem(name: "per_page", value: "100")])
        async let combined = try? get("\(repo)/commits/\(pull.headSHA)/status", token: token)
        async let reviews = try? get("\(repo)/pulls/\(pull.status.number)/reviews", token: token,
                                     query: [URLQueryItem(name: "per_page", value: "100")])

        var status = pull.status
        status.ci = GitHubParse.ci(checkRuns: await checkRuns, combinedStatus: await combined)
        status.review = GitHubParse.review(await reviews)
        return status
    }

    private func get(_ path: String, token: String, query: [URLQueryItem] = []) async throws -> Data {
        var components = URLComponents(url: Self.base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue("Motes", forHTTPHeaderField: "User-Agent")

        let (data, response) = try await session.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch code {
        case 200..<300: return data
        case 401: throw Failure.unauthorized
        case 403, 429:
            let remaining = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "x-ratelimit-remaining")
            throw remaining == "0" || code == 429 ? Failure.rateLimited : Failure.http(code)
        default: throw Failure.http(code)
        }
    }
}
