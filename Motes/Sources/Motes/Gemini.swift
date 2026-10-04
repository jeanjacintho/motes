extension MotePersonality {
    /// Gemini CLI: curious violet light, lopsided eyes, a steeply tilted orbit.
    static let gemini = MotePersonality(
        id: "gemini",
        name: "Gemini",
        color: MoteColor(hex: 0xA77BFF),
        eyes: .init(width: 0.352, height: 0.4, spacing: 0.38, rightScale: 0.62),
        orbit: .init(particles: 4, speed: 0.8, radius: 1.55, flatten: 0.25, tilt: 0.9),
        motion: .init(gazeReach: 0.2, gazeResponsiveness: 7)
    )
}
