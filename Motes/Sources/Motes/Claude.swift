extension MotePersonality {
    /// Claude Code: calm coral light, a few slow, wide-orbiting specks.
    static let claude = MotePersonality(
        id: "claude",
        name: "Claude",
        color: MoteColor(hex: 0xFF7A45),
        eyes: .init(width: 0.216, height: 0.56, spacing: 0.36, angle: -0.1),
        orbit: .init(particles: 3, speed: 0.55, radius: 1.6, flatten: 0.3, tilt: -0.15),
        motion: .init(breathPeriod: 4.2, gazeResponsiveness: 4.5, energy: 0.8)
    )
}
