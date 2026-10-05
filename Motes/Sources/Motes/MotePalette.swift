/// The nine colors a mote can have.
enum MotePalette: String, CaseIterable, Codable, Sendable {
    case coral, amber, yellow, green, teal, blue, violet, pink, silver

    var color: MoteColor {
        switch self {
        case .coral: MoteColor(hex: 0xFF7A45)
        case .amber: MoteColor(hex: 0xFFB02E)
        case .yellow: MoteColor(hex: 0xF2D544)
        case .green: MoteColor(hex: 0x2BD48A)
        case .teal: MoteColor(hex: 0x22C7D6)
        case .blue: MoteColor(hex: 0x3D8BFF)
        case .violet: MoteColor(hex: 0xA77BFF)
        case .pink: MoteColor(hex: 0xFF4FB8)
        case .silver: MoteColor(hex: 0xCBD3DC)
        }
    }

    var title: String { rawValue.capitalized }
}
