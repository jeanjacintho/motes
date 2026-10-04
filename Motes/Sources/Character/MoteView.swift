import AppKit
import SwiftUI

/// Animated mote. Runs its own clock only while `isActive`; when inactive it
/// draws nothing and costs nothing.
struct MoteView: View {
    let personality: MotePersonality
    let state: MoteState
    /// Screen point (AppKit coordinates) the mote is drawn at, used to follow the pointer.
    let screenAnchor: CGPoint?
    var framesPerSecond: Double = 60
    var isActive = true

    @State private var driver: MoteDriver

    init(
        personality: MotePersonality,
        state: MoteState,
        screenAnchor: CGPoint?,
        framesPerSecond: Double = 60,
        isActive: Bool = true
    ) {
        self.personality = personality
        self.state = state
        self.screenAnchor = screenAnchor
        self.framesPerSecond = framesPerSecond
        self.isActive = isActive
        _driver = State(initialValue: MoteDriver(personality: personality))
    }

    var body: some View {
        let fps = state == .sleeping ? min(framesPerSecond, 20) : framesPerSecond
        TimelineView(.animation(minimumInterval: 1 / fps, paused: !isActive)) { timeline in
            Canvas { context, size in
                let time = timeline.date.timeIntervalSinceReferenceDate
                let pose = driver.pose(at: time, state: state, pointer: pointerOffset())
                MoteRenderer.draw(pose, personality: personality, in: &context, size: size)
            }
        }
    }

    private func pointerOffset() -> CGVector? {
        guard let screenAnchor else { return nil }
        let mouse = NSEvent.mouseLocation
        // AppKit y grows upwards; the pose uses y downwards.
        return CGVector(dx: mouse.x - screenAnchor.x, dy: screenAnchor.y - mouse.y)
    }
}

/// Holds the animator across frames. A class so the Canvas closure can advance it.
@MainActor
final class MoteDriver {
    private var animator: MoteAnimator

    init(personality: MotePersonality) {
        animator = MoteAnimator(personality: personality)
    }

    func pose(at time: Double, state: MoteState, pointer: CGVector?) -> MotePose {
        animator.setState(state, at: time)
        return animator.step(at: time, pointer: pointer)
    }
}
