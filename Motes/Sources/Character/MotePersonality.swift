import CoreGraphics

/// Everything that makes one mote different from another. Data only: the
/// animator and the renderer read it, they never special-case a mote by ID.
///
/// A mote is a small orb of light with a face and its own dust orbiting it.
struct MotePersonality: Equatable, Sendable {
    /// Stable contract value, matches the agent name ("claude", "codex"…). Never rename one.
    let id: String
    /// Shown in the UI.
    let name: String
    /// The mote's light. The bright core, the halo, the dust and the eye ink derive from it.
    let color: MoteColor
    var shape = Shape()
    let eyes: Eyes
    let orbit: Orbit
    var motion = Motion()

    struct Shape: Equatable, Sendable {
        /// Body width and height relative to the mote's base radius.
        var width = 1.0
        var height = 1.0
    }

    struct Eyes: Equatable, Sendable {
        /// Eye size and spacing relative to the base radius.
        var width: Double
        var height: Double
        var spacing: Double
        /// Lean of the pills, in radians. Positive leans the tops to the right.
        var angle = 0.0
        /// Lean the eyes away from each other instead of in parallel.
        var mirrored = false
        /// Size of each eye relative to `width`/`height`, for lopsided faces.
        var leftScale = 1.0
        var rightScale = 1.0
        /// Seconds between blinks, picked at random in this range.
        var blinkInterval: ClosedRange<Double> = 2.4...5.5
        /// Chance that a blink is a double blink.
        var doubleBlinkChance = 0.2
    }

    /// The dust that circles the mote.
    struct Orbit: Equatable, Sendable {
        var particles: Int
        /// Radians per second at rest; states speed it up or slow it down.
        var speed: Double
        /// Orbit radius relative to the base radius.
        var radius = 1.5
        /// How flat the orbit looks (1 is a circle seen from the front).
        var flatten = 0.35
        /// Tilt of the orbit plane, in radians.
        var tilt = 0.0
        /// Particle radius relative to the base radius.
        var particleSize = 0.09
    }

    struct Motion: Equatable, Sendable {
        /// Breathing period (seconds) and amplitude (fraction of the body size).
        var breathPeriod = 3.6
        var breathAmount = 0.025
        /// How far the eyes travel when following the pointer, relative to the base radius.
        var gazeReach = 0.16
        /// How fast the gaze catches up with the pointer (per second, higher is snappier).
        var gazeResponsiveness = 6.0
        /// Overall energy multiplier for bounces, shakes and hops.
        var energy = 1.0
    }
}

extension MotePersonality {
    /// Bright, almost white center of the orb.
    var coreColor: MoteColor { MoteColor(r: 1, g: 1, b: 1).mixed(with: color, amount: 0.35) }
    /// Deep shade of the mote's color used for the eyes.
    var inkColor: MoteColor { color.mixed(with: MoteColor(r: 0, g: 0, b: 0), amount: 0.8) }
}
