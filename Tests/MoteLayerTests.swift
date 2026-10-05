import AppKit
import QuartzCore
import Testing
@testable import Motes

struct MoteBlinkTests {
    let range = 2.4...5.5

    @Test func sameSeedSameRhythm() {
        let a = MoteBlink.make(interval: range, doubleChance: 0.2, seed: 7)
        let b = MoteBlink.make(interval: range, doubleChance: 0.2, seed: 7)
        #expect(a == b)
        #expect(a != MoteBlink.make(interval: range, doubleChance: 0.2, seed: 8))
    }

    @Test func wellFormedKeyframes() {
        for seed in 0..<50 as Range<UInt64> {
            let blink = MoteBlink.make(interval: range, doubleChance: 0.3, seed: seed)
            #expect(blink.keyTimes.count == blink.values.count)
            #expect(blink.keyTimes.first == 0 && blink.keyTimes.last == 1)
            #expect(zip(blink.keyTimes, blink.keyTimes.dropFirst()).allSatisfy { $0 <= $1 })
            #expect(blink.values.allSatisfy { $0 == 1 || $0 == MoteBlink.closed })
            #expect(blink.values.contains(MoteBlink.closed))
            #expect(blink.period >= 12)
        }
    }

    @Test func blinksAreSpacedByTheInterval() {
        let blink = MoteBlink.make(interval: range, doubleChance: 0, seed: 3)
        // Start of each blink, in seconds: every "closed" value sits half a blink after its start.
        let closes = zip(blink.keyTimes, blink.values).filter { $0.1 == MoteBlink.closed }.map { $0.0 * blink.period }
        let gaps = zip(closes, closes.dropFirst()).map { $1 - $0 }
        #expect(!gaps.isEmpty)
        #expect(gaps.allSatisfy { $0 >= range.lowerBound + MoteBlink.blinkDuration - 0.001 })
        #expect(gaps.allSatisfy { $0 <= range.upperBound + MoteBlink.blinkDuration + 0.001 })
    }

    @Test func stableSeed() {
        #expect(MoteBlink.seed(for: "claude") == MoteBlink.seed(for: "claude"))
        #expect(MoteBlink.seed(for: "claude") != MoteBlink.seed(for: "codex"))
    }
}

@MainActor
struct MoteLayerTests {
    func mote(_ personality: MotePersonality = .claude, _ state: MoteState = .idle) -> MoteLayer {
        let layer = MoteLayer(personality: personality)
        layer.frame = CGRect(x: 0, y: 0, width: 100, height: 100)
        layer.layoutIfNeeded()
        layer.apply(state)
        return layer
    }

    /// All layers in the tree.
    func all(_ layer: CALayer) -> [CALayer] {
        [layer] + (layer.sublayers ?? []).flatMap(all)
    }

    func animationKeys(_ layer: CALayer) -> Set<String> {
        Set(all(layer).flatMap { $0.animationKeys() ?? [] })
    }

    @Test func idleMoteBreathesOrbitsAndBlinks() {
        let keys = animationKeys(mote())
        #expect(keys.contains("breath"))
        #expect(keys.contains("orbit"))
        #expect(keys.contains("blink"))
    }

    @Test func oneParticlePerOrbitSpeck() {
        for personality in MoteRegistry.all {
            let orbiting = all(mote(personality)).filter { $0.animation(forKey: "orbit") != nil }
            #expect(orbiting.count == personality.orbit.particles)
        }
    }

    @Test func workingSpeedsTheDustUp() {
        let layer = mote(.claude, .working)
        let dust = all(layer).filter { $0.animation(forKey: "orbit") != nil }
        #expect(dust.allSatisfy { $0.speed == Float(MoteStateStyle.of(.working).orbitSpeed) })
        layer.apply(.sleeping)
        #expect(dust.allSatisfy { $0.speed == Float(MoteStateStyle.of(.sleeping).orbitSpeed) })
    }

    @Test func closedEyesDontBlink() {
        let layer = mote(.claude, .sleeping)
        #expect(!animationKeys(layer).contains("blink"))
        layer.apply(.idle)
        #expect(animationKeys(layer).contains("blink"))
    }

    @Test(arguments: [(MoteState.working, "pulse"), (.sleeping, "sleep"), (.tired, "sweat")])
    func badgesAnimate(_ state: MoteState, _ key: String) {
        #expect(animationKeys(mote(.claude, state)).contains(key))
    }

    @Test func idleHasNoBadge() {
        let keys = animationKeys(mote(.claude, .idle))
        #expect(!keys.contains("pulse") && !keys.contains("sleep") && !keys.contains("sweat"))
    }

    @Test func statesWithMotion() {
        #expect(animationKeys(mote(.claude, .working)).contains("state"))
        #expect(animationKeys(mote(.claude, .approval)).contains("state"))
        #expect(!animationKeys(mote(.claude, .idle)).contains("state"))
    }

    @Test func everyStateBuildsForEveryMote() {
        for personality in MoteRegistry.all {
            for state in MoteState.allCases {
                let layer = mote(personality, state)
                #expect(layer.state == state)
                #expect(!(layer.sublayers ?? []).isEmpty)
            }
        }
    }

    @Test func orbitPathStaysAroundTheMote() {
        let path = MoteLayer.orbitPath(center: CGPoint(x: 50, y: 50), radius: 30, flatten: 0.4, tilt: 0.3)
        let box = path.boundingBoxOfPath
        #expect(abs(box.midX - 50) < 0.5 && abs(box.midY - 50) < 0.5)
        #expect(box.width <= 60.5 && box.height <= 60.5)
    }

    @Test func pointerMovesOnlyTheEyes() {
        let layer = mote()
        let before = all(layer).map(\.position)
        layer.pointerMoved(CGVector(dx: 500, dy: 0))
        let moved = zip(before, all(layer).map(\.position)).filter { $0 != $1 }
        #expect(moved.count == 1)
    }
}
