import Foundation

/// A mote the user created: a named companion bound to a folder and a CLI.
struct Mote: Identifiable, Codable, Equatable, Sendable {
    /// Stable ID, also passed to the terminal as `MOTES_MOTE_ID`.
    let id: String
    var name: String
    /// Absolute path of the project folder.
    var folder: String
    var form: MoteForm
    var color: MotePalette
    var cli: MoteCLI
    var createdAt: Date

    static let maxNameLength = 24

    init(id: String = Mote.newID(), name: String, folder: String, form: MoteForm,
         color: MotePalette, cli: MoteCLI, createdAt: Date = .now) {
        self.id = id
        self.name = name
        self.folder = folder
        self.form = form
        self.color = color
        self.cli = cli
        self.createdAt = createdAt
    }

    static func newID() -> String { UUID().uuidString.lowercased() }

    var personality: MotePersonality {
        MotePersonality(id: id, name: name, form: form, color: color)
    }

    /// The mote whose folder contains `cwd`; the deepest folder wins.
    static func owner(of cwd: String, in motes: [Mote]) -> Mote? {
        let path = normalized(cwd)
        return motes
            .filter { mote in
                let folder = normalized(mote.folder)
                return path == folder || path.hasPrefix(folder == "/" ? "/" : folder + "/")
            }
            .max { normalized($0.folder).count < normalized($1.folder).count }
    }

    private static func normalized(_ path: String) -> String {
        let standard = (path as NSString).standardizingPath
        return standard.count > 1 && standard.hasSuffix("/") ? String(standard.dropLast()) : standard
    }
}

/// Coding CLIs a mote can run.
enum MoteCLI: String, CaseIterable, Codable, Sendable {
    case claude, codex, gemini

    var title: String {
        switch self {
        case .claude: "Claude Code"
        case .codex: "Codex"
        case .gemini: "Gemini CLI"
        }
    }

    /// Command typed in the terminal.
    var command: String { rawValue }

    /// Agent name its hooks report (`motes_agent`).
    var agent: String { rawValue }

    /// Whether Motes can install this CLI's hooks yet. Without them the
    /// terminal opens fine, but the mote can't show live state.
    var hasHookSupport: Bool { self == .claude || self == .codex }
}
