extension MotePersonality {
    /// Any agent without its own mote: friendly green light with eyes leaning apart.
    static let `default` = MotePersonality(
        id: "default",
        name: "Agent",
        color: MoteColor(hex: 0x2BD48A),
        eyes: .init(width: 0.208, height: 0.528, spacing: 0.34, angle: -0.35, mirrored: true),
        orbit: .init(particles: 3, speed: 0.7, radius: 1.5, flatten: 0.4)
    )
}
