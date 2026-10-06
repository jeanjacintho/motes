import Foundation

/// One running session of a coding agent, as Motes sees it.
struct AgentSession: Identifiable, Equatable, Sendable {
    let id: String
    /// Agent name, also the mote ID ("claude", "codex"…).
    var agent: String
    /// Mote the session belongs to; `nil` uses the agent's automatic mote.
    var moteID: String?
    /// Shown in the island: the working folder's name.
    var name: String
    var cwd: String?
    var state: MoteState
    /// Latest actions, oldest first ("Edit Foo.swift", "Bash npm test").
    var feed: [String] = []
    /// File edits of this session, oldest first, capped at `maxChanges`.
    var changes: [FileChange] = []
    /// The edit the latest feed line is about, shown with its +N −M.
    var latestChange: FileChange?
    var terminal: [String: String] = [:]
    var startedAt: Date
    var lastEventAt: Date
    var stateChangedAt: Date

    static let maxFeed = 20
    static let maxChanges = 50

    var latestActivity: String? { feed.last }
}
