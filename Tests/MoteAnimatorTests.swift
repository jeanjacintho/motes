import CoreGraphics
import Testing
@testable import Motes

struct MoteAnimatorTests {
    let personality = MotePersonality.default

    /// Runs the animator at 60 fps from `start` for `duration` seconds.
    func run(
        _ animator: inout MoteAnimator, from start: Double, for duration: Double,
        pointer: CGVector? = nil
    ) -> [MotePose] {
        stride(from: start, through: start + duration, by: 1.0 / 60).map {
            animator.step(at: $0, pointer: pointer)
        }
    }

    @Test(arguments: MoteState.allCases)
    func everyStateProducesSanePoses(_ state: MoteState) {
        var a = MoteAnimator(personality: personality, seed: 1)
        a.setState(state, at: 0)
        for pose in run(&a, from: 0, for: 5, pointer: CGVector(dx: 300, dy: -80)) {
            #expect(pose.scaleX.isFinite && pose.scaleY.isFinite)
            #expect(pose.scaleX > 0.8 && pose.scaleX < 1.2)
            #expect(pose.scaleY > 0.8 && pose.scaleY < 1.2)
            #expect(abs(pose.offset.dx) <= 0.3 && abs(pose.offset.dy) <= 0.3)
            #expect((0...1).contains(pose.eyeOpenness))
            #expect(abs(pose.gaze.dx) <= personality.motion.gazeReach + 1e-9)
            #expect(abs(pose.gaze.dy) <= personality.motion.gazeReach + 1e-9)
        }
    }

    @Test func blinksWithinTheConfiguredInterval() {
        var a = MoteAnimator(personality: personality, seed: 42)
        let poses = run(&a, from: 0, for: personality.eyes.blinkInterval.upperBound + 0.5)
        #expect(poses.contains { $0.eyeOpenness < 0.5 })
        #expect(poses.first?.eyeOpenness == 1)
    }

    @Test func sameSeedSameBlinks() {
        var a = MoteAnimator(personality: personality, seed: 7)
        var b = MoteAnimator(personality: personality, seed: 7)
        #expect(run(&a, from: 0, for: 12) == run(&b, from: 0, for: 12))
    }

    @Test func sleepingKeepsEyesShut() {
        var a = MoteAnimator(personality: personality, seed: 3)
        a.setState(.sleeping, at: 0)
        let poses = run(&a, from: 0, for: 8)
        #expect(poses.allSatisfy { $0.eyeOpenness == 0 && $0.eyeShape == .closed })
        #expect(poses.allSatisfy { $0.badge == .sleep })
    }

    @Test func tiredEyesStayHalfClosedAndStillBlink() {
        var a = MoteAnimator(personality: personality, seed: 5)
        a.setState(.tired, at: 0)
        let poses = run(&a, from: 0, for: personality.eyes.blinkInterval.upperBound + 0.5)
        #expect(poses.allSatisfy { $0.eyeShape == .droopy && $0.badge == .sweat })
        #expect(poses.allSatisfy { $0.eyeOpenness <= MoteAnimator.tiredEyeOpenness })
        #expect(poses.contains { $0.eyeOpenness < MoteAnimator.tiredEyeOpenness * 0.5 })
    }

    @Test func tiredLooksDownAndSags() {
        var a = MoteAnimator(personality: personality, seed: 1)
        a.setState(.tired, at: 0)
        let pose = run(&a, from: 0, for: 2, pointer: CGVector(dx: 0, dy: -500)).last!
        #expect(pose.gaze.dy > 0)
        #expect(pose.offset.dy > 0)
    }

    @Test func happyAndFlatEyesNeverBlink() {
        for state in [MoteState.finished, .error] {
            var a = MoteAnimator(personality: personality, seed: 9)
            a.setState(state, at: 0)
            #expect(run(&a, from: 0, for: 8).allSatisfy { $0.eyeOpenness == 1 })
        }
    }

    @Test func errorShakesThenSettles() {
        var a = MoteAnimator(personality: personality, seed: 1)
        a.setState(.error, at: 0)
        let shaking = run(&a, from: 0, for: MoteAnimator.shakeDuration * 0.8)
        #expect(shaking.contains { abs($0.offset.dx) > 0.02 })
        let settled = run(&a, from: MoteAnimator.shakeDuration + 0.05, for: 1)
        #expect(settled.allSatisfy { $0.offset.dx == 0 })
    }

    @Test func finishedHopsOnce() {
        var a = MoteAnimator(personality: personality, seed: 1)
        a.setState(.finished, at: 0)
        let hop = run(&a, from: 0, for: MoteAnimator.hopDuration)
        #expect(hop.contains { $0.offset.dy < -0.15 })
        let after = run(&a, from: MoteAnimator.hopDuration + 0.05, for: 1)
        #expect(after.allSatisfy { $0.offset.dy == 0 })
    }

    @Test func gazeFollowsThePointer() {
        var a = MoteAnimator(personality: personality, seed: 1)
        let right = run(&a, from: 0, for: 2, pointer: CGVector(dx: 500, dy: 0)).last!
        #expect(right.gaze.dx > personality.motion.gazeReach * 0.8)
        let left = run(&a, from: 2, for: 2, pointer: CGVector(dx: -500, dy: 0)).last!
        #expect(left.gaze.dx < -personality.motion.gazeReach * 0.8)
    }

    @Test func thinkingLooksUpAndAside() {
        var a = MoteAnimator(personality: personality, seed: 1)
        a.setState(.thinking, at: 0)
        let pose = run(&a, from: 0, for: 2, pointer: CGVector(dx: -500, dy: 500)).last!
        #expect(pose.gaze.dx > 0 && pose.gaze.dy < 0)
    }

    @Test func workingDustOrbitsFasterThanIdle() {
        func travelled(_ state: MoteState) -> Double {
            var a = MoteAnimator(personality: personality, seed: 1)
            a.setState(state, at: 0)
            // Unwrap the angle frame by frame over two seconds, after the speed settled.
            let poses = run(&a, from: 0, for: 4)
            var total = 0.0
            for (p, q) in zip(poses.dropFirst(120), poses.dropFirst(121)) {
                var d = q.orbitAngle - p.orbitAngle
                if d < -.pi { d += 2 * .pi }
                total += d
            }
            return total
        }
        #expect(travelled(.working) > travelled(.idle) * 2)
        #expect(travelled(.sleeping) < travelled(.idle) * 0.5)
    }

    @Test func dustDimsWhenSleeping() {
        var a = MoteAnimator(personality: personality, seed: 1)
        a.setState(.sleeping, at: 0)
        #expect(run(&a, from: 0, for: 2).last!.dust < 0.3)
    }

    @Test func stateColorEasesIn() {
        var a = MoteAnimator(personality: personality, seed: 1)
        _ = run(&a, from: 0, for: 1)
        a.setState(.approval, at: 1)
        let target = MoteStateStyle.of(.approval)
        let first = a.step(at: 1 + 1.0 / 60, pointer: nil)
        #expect(first.glow < target.glow * 0.5)
        let later = run(&a, from: 1.1, for: 1).last!
        #expect(abs(later.glow - target.glow) < 0.01)
        #expect(abs(later.stateColor.r - target.color.r) < 0.01)
    }

    @Test func longPauseDoesNotJump() {
        var a = MoteAnimator(personality: personality, seed: 1)
        _ = run(&a, from: 0, for: 1)
        a.setState(.approval, at: 1)
        // The view was paused for a minute: one step must not finish the color change.
        let pose = a.step(at: 61, pointer: nil)
        #expect(pose.glow < MoteStateStyle.of(.approval).glow * 0.9)
    }
}

struct MoteColorTests {
    @Test func hex() {
        let c = MoteColor(hex: 0xFF8000)
        #expect(c.r == 1 && c.b == 0 && abs(c.g - 128.0 / 255) < 1e-9)
    }

    @Test func mixClamps() {
        let black = MoteColor(r: 0, g: 0, b: 0), white = MoteColor(r: 1, g: 1, b: 1)
        #expect(black.mixed(with: white, amount: 2) == white)
        #expect(black.mixed(with: white, amount: -1) == black)
        #expect(black.mixed(with: white, amount: 0.5).r == 0.5)
    }
}
