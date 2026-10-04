import CoreGraphics
import Foundation

/// Turns a personality, a state and the pointer position into a pose, frame by frame.
/// Pure and deterministic for a given seed, so it can be unit tested.
struct MoteAnimator {
    let personality: MotePersonality
    private(set) var state: MoteState = .idle

    private var stateEnteredAt: Double?
    private var lastTime: Double?
    private var nextBlinkAt: Double = 0
    private var blinkStartedAt: Double?
    private var doubleBlinkPending = false
    private var gaze = CGVector.zero
    private var stateColor = MoteStateStyle.of(.idle).color
    private var glow = 0.0
    private var orbitAngle = 0.0
    private var orbitSpeed = 1.0
    private var dust = MoteStateStyle.of(.idle).dust
    private var rng: SplitMix64

    static let blinkDuration = 0.14
    static let shakeDuration = 0.45
    static let hopDuration = 0.6
    /// Tired eyes never open more than this.
    static let tiredEyeOpenness = 0.45
    /// Larger frame gaps (the view was paused) are treated as this long.
    static let maxStep = 0.1

    init(personality: MotePersonality, seed: UInt64 = .random(in: 0...UInt64.max)) {
        self.personality = personality
        rng = SplitMix64(seed: seed)
    }

    mutating func setState(_ newState: MoteState, at time: Double) {
        guard newState != state else { return }
        state = newState
        stateEnteredAt = time
        blinkStartedAt = nil
    }

    /// - Parameter pointer: pointer position relative to the mote center, in points,
    ///   y growing downwards. `nil` when unknown: the mote looks ahead.
    mutating func step(at time: Double, pointer: CGVector?) -> MotePose {
        let dt = min(max(time - (lastTime ?? time), 0), Self.maxStep)
        if lastTime == nil {
            nextBlinkAt = time + randomBlinkInterval()
            stateEnteredAt = stateEnteredAt ?? time
        }
        lastTime = time

        let style = MoteStateStyle.of(state)
        let motion = personality.motion
        let sinceEntered = time - (stateEnteredAt ?? time)
        var pose = MotePose()
        pose.phase = time
        pose.eyeShape = style.eyes
        pose.badge = style.badge

        // Colors ease towards the state's, so state changes never pop.
        let ease = 1 - exp(-dt * 8)
        stateColor = stateColor.mixed(with: style.color, amount: ease)
        glow += (style.glow - glow) * ease
        pose.stateColor = stateColor

        // Dust: speed eases between states so the orbit never jumps.
        orbitSpeed += (style.orbitSpeed - orbitSpeed) * (1 - exp(-dt * 3))
        dust += (style.dust - dust) * ease
        orbitAngle = (orbitAngle + personality.orbit.speed * orbitSpeed * dt)
            .truncatingRemainder(dividingBy: 2 * .pi)
        pose.orbitAngle = orbitAngle
        pose.dust = dust
        pose.glow = glow

        // Breathing.
        var breathPeriod = motion.breathPeriod
        var breathAmount = motion.breathAmount
        switch state {
        case .working, .thinking: breathPeriod *= 0.7
        case .tired: breathPeriod *= 1.3; breathAmount *= 1.5
        case .sleeping: breathPeriod *= 1.6; breathAmount *= 1.6
        default: break
        }
        let breath = sin(time * 2 * .pi / breathPeriod) * breathAmount
        pose.scaleX = 1 - breath * 0.5
        pose.scaleY = 1 + breath

        // State motion.
        let energy = motion.energy
        switch state {
        case .working:
            pose.offset.dy = sin(time * 2 * .pi / 0.9) * 0.02 * energy
        case .approval:
            let hop = abs(sin(time * .pi / 1.1))
            pose.offset.dy = -hop * 0.1 * energy
            pose.scaleY *= 1 - (1 - hop) * 0.06 * energy
            pose.scaleX *= 1 + (1 - hop) * 0.06 * energy
        case .question:
            pose.tilt = 0.16
        case .tired:
            // Sagging: a bit lower, wider and flatter.
            pose.offset.dy = 0.04
            pose.scaleX *= 1.03
            pose.scaleY *= 0.96
        case .error where sinceEntered < Self.shakeDuration:
            let fade = 1 - sinceEntered / Self.shakeDuration
            pose.offset.dx = sin(sinceEntered * 45) * 0.08 * fade * energy
        case .finished where sinceEntered < Self.hopDuration:
            let hop = sin(sinceEntered / Self.hopDuration * .pi)
            pose.offset.dy = -hop * 0.22 * energy
            pose.scaleY *= 1 + hop * 0.06
            pose.scaleX *= 1 - hop * 0.04
        default:
            break
        }

        // Gaze.
        var target = CGVector.zero
        switch state {
        case .thinking:
            target = CGVector(dx: 0.6, dy: -0.6)
        case .sleeping:
            target = CGVector(dx: 0, dy: 0.3)
        case .tired:
            // Looks down, barely glancing at the pointer.
            let glance = pointer.map { tanh($0.dx / 260) * 0.3 } ?? 0
            target = CGVector(dx: glance, dy: 0.55)
        default:
            if let pointer {
                target = CGVector(dx: tanh(pointer.dx / 260), dy: tanh(pointer.dy / 200))
            }
        }
        let follow = 1 - exp(-dt * motion.gazeResponsiveness)
        gaze.dx += (target.dx - gaze.dx) * follow
        gaze.dy += (target.dy - gaze.dy) * follow
        pose.gaze = CGVector(dx: gaze.dx * motion.gazeReach, dy: gaze.dy * motion.gazeReach)

        // Blinks, only for eyes that can blink.
        switch state {
        case .sleeping: pose.eyeOpenness = 0
        case .tired: pose.eyeOpenness = blinkOpenness(at: time) * Self.tiredEyeOpenness
        default: pose.eyeOpenness = blinkOpenness(at: time)
        }
        return pose
    }

    private mutating func blinkOpenness(at time: Double) -> Double {
        guard Self.canBlink(MoteStateStyle.of(state).eyes) else { return 1 }
        if blinkStartedAt == nil, time >= nextBlinkAt {
            blinkStartedAt = time
        }
        guard let start = blinkStartedAt else { return 1 }
        let progress = (time - start) / Self.blinkDuration
        if progress >= 1 {
            blinkStartedAt = nil
            if doubleBlinkPending {
                doubleBlinkPending = false
                nextBlinkAt = time + 0.12
            } else {
                doubleBlinkPending = rng.nextUnit() < personality.eyes.doubleBlinkChance
                nextBlinkAt = time + (doubleBlinkPending ? 0.12 : randomBlinkInterval())
            }
            return 1
        }
        // Close then open: 1 → 0 → 1.
        return abs(1 - 2 * progress)
    }

    private static func canBlink(_ eyes: MoteEyeShape) -> Bool {
        eyes == .open || eyes == .wide || eyes == .droopy
    }

    private mutating func randomBlinkInterval() -> Double {
        let range = personality.eyes.blinkInterval
        return range.lowerBound + (range.upperBound - range.lowerBound) * rng.nextUnit()
    }
}

/// Small seedable generator so blinks are reproducible in tests.
struct SplitMix64: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// Uniform value in 0..<1.
    mutating func nextUnit() -> Double {
        Double(next() >> 11) / Double(1 << 53)
    }
}
