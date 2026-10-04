import CoreGraphics

/// Everything the renderer needs to draw one frame of a mote.
/// Lengths are in units of the mote's base radius; y grows downwards.
struct MotePose: Equatable, Sendable {
    var scaleX: Double = 1
    var scaleY: Double = 1
    var offset: CGVector = .zero
    var tilt: Double = 0
    /// 1 is fully open, 0 is shut (blinks, sleep).
    var eyeOpenness: Double = 1
    var eyeShape: MoteEyeShape = .open
    var gaze: CGVector = .zero
    var stateColor: MoteColor = MoteStateStyle.of(.idle).color
    var glow: Double = 0
    var badge: MoteBadge?
    /// Accumulated angle of the orbiting dust, in radians.
    var orbitAngle: Double = 0
    /// Dust brightness (0…1).
    var dust: Double = 0.8
    /// Free-running clock (seconds) for badge and particle loops.
    var phase: Double = 0
}
