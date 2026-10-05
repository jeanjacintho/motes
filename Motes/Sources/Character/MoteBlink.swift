/// A blink rhythm baked into one repeating keyframe animation, so the render
/// server can play it forever without waking the app. Pure, so it's testable.
struct MoteBlink: Equatable {
    /// Normalized times (0…1) and eye heights (1 open, `closed` shut), for a
    /// `transform.scale.y` keyframe animation lasting `period` seconds.
    let keyTimes: [Double]
    let values: [Double]
    let period: Double

    /// Stable seed for a mote ID (FNV-1a), so a mote always blinks the same way.
    static func seed(for id: String) -> UInt64 {
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325
        for byte in id.utf8 {
            hash ^= UInt64(byte)
            hash &*= 0x0000_0100_0000_01B3
        }
        return hash
    }

    static let blinkDuration = 0.14
    static let closed = 0.08
    /// Gap between the two blinks of a double blink.
    static let doubleGap = 0.12

    /// Blinks spaced by random intervals in `interval`, some of them doubled,
    /// laid out over one loop of about `minimumPeriod` seconds.
    static func make(interval: ClosedRange<Double>, doubleChance: Double, seed: UInt64,
                     minimumPeriod: Double = 12) -> MoteBlink {
        var rng = SplitMix64(seed: seed)
        func random(in range: ClosedRange<Double>) -> Double {
            range.lowerBound + (range.upperBound - range.lowerBound) * rng.nextUnit()
        }

        // Blink start times, then the loop length so the last gap is as random as the others.
        var starts: [Double] = []
        var time = random(in: interval)
        while time < minimumPeriod {
            starts.append(time)
            if rng.nextUnit() < doubleChance {
                starts.append(time + blinkDuration + doubleGap)
            }
            time = (starts.last ?? time) + blinkDuration + random(in: interval)
        }
        let period = max(time, (starts.last ?? 0) + blinkDuration + 0.1)

        var keyTimes: [Double] = [0]
        var values: [Double] = [1]
        for start in starts {
            keyTimes += [start, start + blinkDuration / 2, start + blinkDuration].map { $0 / period }
            values += [1, closed, 1]
        }
        keyTimes.append(1)
        values.append(1)
        return MoteBlink(keyTimes: keyTimes, values: values, period: period)
    }
}

/// Small seedable generator so rhythms are reproducible.
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
