/// Automatic motes: used for sessions that don't belong to a mote the user
/// created (started outside Motes, in a folder no mote owns).
extension MotePersonality {
    static let claude = MotePersonality(id: "claude", name: "Claude", form: .calm, color: .coral)
    static let codex = MotePersonality(id: "codex", name: "Codex", form: .restless, color: .blue)
    static let gemini = MotePersonality(id: "gemini", name: "Gemini", form: .curious, color: .violet)
    static let cursor = MotePersonality(id: "cursor", name: "Cursor", form: .bubbly, color: .pink)
    static let `default` = MotePersonality(id: "default", name: "Agent", form: .easygoing, color: .green)
}

enum MoteRegistry {
    static let all: [MotePersonality] = [.claude, .codex, .gemini, .cursor, .default]

    /// Automatic mote for an agent name (`motes_agent`), or the default one.
    static func personality(for agentID: String) -> MotePersonality {
        all.first { $0.id == agentID } ?? .default
    }
}
