/// What a mote is doing. Driven by its agent's sessions (from M3) or the Debug menu.
enum MoteState: String, CaseIterable, Sendable {
    case idle
    case working
    case thinking
    case approval
    case question
    case error
    case finished
    /// Worn out, like 😓: usage limit reached or a session dragging on.
    case tired
    case sleeping

    /// Alerts need the user and are shown with more energy.
    var isAlert: Bool { self == .approval || self == .question || self == .error }
}

enum MoteEyeShape: Equatable, Sendable {
    /// Rounded vertical pills.
    case open
    /// Bigger pills, for alerts.
    case wide
    /// Upside-down arcs, happy.
    case happy
    /// Short flat lines, upset.
    case flat
    /// Half-closed eyes looking down under sad brows, worn out.
    case droopy
    /// Thin closed lines.
    case closed
}

enum MoteBadge: Equatable, Sendable {
    /// Three dots cycling, busy.
    case dots
    case exclamation
    case questionMark
    case sleep
    /// Sweat drop sliding down the side of the head.
    case sweat
}

/// Visual traits shared by every mote in a given state. Personalities add on top.
struct MoteStateStyle: Equatable, Sendable {
    /// Used for the halo and the badge; the body keeps the mote's own color.
    let color: MoteColor
    /// Halo strength behind the mote (0…1).
    let glow: Double
    let eyes: MoteEyeShape
    let badge: MoteBadge?
    /// Multiplier on the personality's orbit speed.
    let orbitSpeed: Double
    /// How bright the dust is (0…1).
    let dust: Double

    static func of(_ state: MoteState) -> MoteStateStyle {
        switch state {
        case .idle:     .init(color: .init(hex: 0xD9DDE3), glow: 0.1, eyes: .open, badge: nil, orbitSpeed: 1, dust: 0.8)
        case .working:  .init(color: .init(hex: 0x4C8DFF), glow: 0.35, eyes: .open, badge: .dots, orbitSpeed: 2.6, dust: 1)
        case .thinking: .init(color: .init(hex: 0x9A6BFF), glow: 0.35, eyes: .open, badge: .dots, orbitSpeed: 1.6, dust: 0.9)
        case .approval: .init(color: .init(hex: 0xFFB020), glow: 0.6, eyes: .wide, badge: .exclamation, orbitSpeed: 1.8, dust: 1)
        case .question: .init(color: .init(hex: 0x2CC8E0), glow: 0.5, eyes: .open, badge: .questionMark, orbitSpeed: 1.2, dust: 1)
        case .error:    .init(color: .init(hex: 0xFF5A67), glow: 0.55, eyes: .flat, badge: .exclamation, orbitSpeed: 0.5, dust: 0.7)
        case .finished: .init(color: .init(hex: 0x3DD68C), glow: 0.45, eyes: .happy, badge: nil, orbitSpeed: 2.2, dust: 1)
        case .tired:    .init(color: .init(hex: 0x7FA2C4), glow: 0.15, eyes: .droopy, badge: .sweat, orbitSpeed: 0.35, dust: 0.45)
        case .sleeping: .init(color: .init(hex: 0x8C96A8), glow: 0.05, eyes: .closed, badge: .sleep, orbitSpeed: 0.2, dust: 0.25)
        }
    }
}
