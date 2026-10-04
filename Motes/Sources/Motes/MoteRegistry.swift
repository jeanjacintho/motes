/// Known motes, in display order. Add a new agent's mote here.
enum MoteRegistry {
    static let all: [MotePersonality] = [.claude, .codex, .gemini, .cursor, .default]

    /// Mote for an agent name (`motes_agent`), or the default one.
    static func personality(for agentID: String) -> MotePersonality {
        all.first { $0.id == agentID } ?? .default
    }
}
