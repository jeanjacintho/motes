import Foundation

/// Opens a specific Claude Code session in the Claude desktop app.
///
/// Not documented by Anthropic, so everything here is best effort and falls
/// back to just bringing the app to the front:
/// - the app opens a Code session with `claude://code/continue?session=local_…`,
///   which takes the app's own session ID, not the CLI `session_id` hooks receive;
/// - the app keeps one JSON file per Code session in
///   `~/Library/Application Support/Claude/claude-code-sessions/<…>/<…>/local_<id>.json`,
///   holding both IDs (`sessionId`, `cliSessionId`). Motes only reads those two fields.
enum ClaudeDesktopSessions {
    static let bundleID = "com.anthropic.claudefordesktop"

    static var sessionsDirectory: URL {
        URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Application Support/Claude/claude-code-sessions", isDirectory: true)
    }

    /// The app's ID for the session whose CLI ID is `cliSessionID`, if one of its files has it.
    static func localSessionID(forCLISession cliSessionID: String, in directory: URL = sessionsDirectory) -> String? {
        guard !cliSessionID.isEmpty else { return nil }
        let manager = FileManager.default
        guard let enumerator = manager.enumerator(at: directory, includingPropertiesForKeys: nil,
                                                  options: [.skipsHiddenFiles]) else { return nil }
        for case let url as URL in enumerator {
            // Files sit two folders deep; don't wander into anything else.
            if enumerator.level > 3 { enumerator.skipDescendants(); continue }
            let name = url.lastPathComponent
            guard name.hasPrefix("local_"), url.pathExtension == "json",
                  let data = try? Data(contentsOf: url),
                  let ids = try? JSONDecoder().decode(SessionIDs.self, from: data),
                  ids.cliSessionId == cliSessionID, isValidLocalID(ids.sessionId)
            else { continue }
            return ids.sessionId
        }
        return nil
    }

    /// `claude://code/continue?session=local_…`
    static func continueURL(localSessionID: String) -> URL? {
        guard isValidLocalID(localSessionID) else { return nil }
        var components = URLComponents()
        components.scheme = "claude"
        components.host = "code"
        components.path = "/continue"
        components.queryItems = [URLQueryItem(name: "session", value: localSessionID)]
        return components.url
    }

    /// Same shape the app accepts: "local_" then letters, digits and hyphens.
    static func isValidLocalID(_ id: String) -> Bool {
        guard id.hasPrefix("local_"), id.count <= 80 else { return false }
        let rest = id.dropFirst("local_".count)
        return !rest.isEmpty && rest.unicodeScalars.allSatisfy { scalar in
            ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar) || ("0"..."9").contains(scalar) || scalar == "-"
        }
    }

    private struct SessionIDs: Decodable {
        let sessionId: String
        let cliSessionId: String
    }
}
