extension MotePersonality {
    /// Cursor: bright pink light, round eyes, two big companions.
    static let cursor = MotePersonality(
        id: "cursor",
        name: "Cursor",
        color: MoteColor(hex: 0xFF4FB8),
        shape: .init(width: 1.05, height: 0.97),
        eyes: .init(width: 0.288, height: 0.288, spacing: 0.36),
        orbit: .init(particles: 2, speed: 0.9, radius: 1.65, flatten: 0.55, tilt: -0.4, particleSize: 0.12),
        motion: .init(breathPeriod: 3.2, energy: 1.1)
    )
}
