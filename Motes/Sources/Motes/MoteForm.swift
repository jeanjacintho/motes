/// The five ways a mote can be: eyes, orbit, proportions and rhythm.
/// Picked when creating a mote; the color is picked separately.
enum MoteForm: String, CaseIterable, Codable, Sendable {
    /// Slow breathing, leaning pills, a few wide-orbiting specks.
    case calm
    /// Tall pills, quick blinks, a busy swarm close to the body.
    case restless
    /// Lopsided eyes, a steeply tilted orbit.
    case curious
    /// Round eyes, two big companions.
    case bubbly
    /// Pills leaning apart, an easy orbit.
    case easygoing

    var title: String {
        switch self {
        case .calm: "Calm"
        case .restless: "Restless"
        case .curious: "Curious"
        case .bubbly: "Bubbly"
        case .easygoing: "Easygoing"
        }
    }

    var shape: MotePersonality.Shape {
        switch self {
        case .bubbly: .init(width: 1.05, height: 0.97)
        default: .init()
        }
    }

    var eyes: MotePersonality.Eyes {
        switch self {
        case .calm: .init(width: 0.216, height: 0.56, spacing: 0.36, angle: -0.1)
        case .restless: .init(width: 0.216, height: 0.608, spacing: 0.34, blinkInterval: 1.8...4)
        case .curious: .init(width: 0.352, height: 0.4, spacing: 0.38, rightScale: 0.62)
        case .bubbly: .init(width: 0.288, height: 0.288, spacing: 0.36)
        case .easygoing: .init(width: 0.208, height: 0.528, spacing: 0.34, angle: -0.35, mirrored: true)
        }
    }

    var orbit: MotePersonality.Orbit {
        switch self {
        case .calm: .init(particles: 3, speed: 0.55, radius: 1.6, flatten: 0.3, tilt: -0.15)
        case .restless: .init(particles: 5, speed: 1.2, radius: 1.4, flatten: 0.45, tilt: 0.2, particleSize: 0.07)
        case .curious: .init(particles: 4, speed: 0.8, radius: 1.55, flatten: 0.25, tilt: 0.9)
        case .bubbly: .init(particles: 2, speed: 0.9, radius: 1.65, flatten: 0.55, tilt: -0.4, particleSize: 0.12)
        case .easygoing: .init(particles: 3, speed: 0.7, radius: 1.5, flatten: 0.4)
        }
    }

    var motion: MotePersonality.Motion {
        switch self {
        case .calm: .init(breathPeriod: 4.2, gazeResponsiveness: 4.5, energy: 0.8)
        case .restless: .init(breathPeriod: 2.8, gazeResponsiveness: 9, energy: 1.3)
        case .curious: .init(gazeReach: 0.2, gazeResponsiveness: 7)
        case .bubbly: .init(breathPeriod: 3.2, energy: 1.1)
        case .easygoing: .init()
        }
    }
}

extension MotePersonality {
    init(id: String, name: String, form: MoteForm, color: MotePalette) {
        self.init(
            id: id, name: name, color: color.color,
            shape: form.shape, eyes: form.eyes, orbit: form.orbit, motion: form.motion
        )
    }
}
