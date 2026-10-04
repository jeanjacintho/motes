extension MotePersonality {
    /// Codex: restless blue light with a busy swarm close to the body.
    static let codex = MotePersonality(
        id: "codex",
        name: "Codex",
        color: MoteColor(hex: 0x3D8BFF),
        eyes: .init(width: 0.216, height: 0.608, spacing: 0.34, blinkInterval: 1.8...4),
        orbit: .init(particles: 5, speed: 1.2, radius: 1.4, flatten: 0.45, tilt: 0.2, particleSize: 0.07),
        motion: .init(breathPeriod: 2.8, gazeResponsiveness: 9, energy: 1.3)
    )
}
