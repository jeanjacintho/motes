import AppKit
import SwiftUI
import Testing
@testable import Motes

/// Renders every mote in every state to a PNG, for eyeballing the style.
/// Runs only when MOTES_RENDER_DIR is set:
///   TEST_RUNNER_MOTES_RENDER_DIR=/some/dir xcodebuild -scheme Motes test
@MainActor
struct MoteSheetTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["MOTES_RENDER_DIR"] != nil))
    func renderSheet() throws {
        let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["MOTES_RENDER_DIR"]!)
        let cell: CGFloat = 120
        let states = MoteState.allCases
        let motes = MoteRegistry.all

        let sheet = Canvas { context, _ in
            for (row, mote) in motes.enumerated() {
                for (column, state) in states.enumerated() {
                    var animator = MoteAnimator(personality: mote, seed: 1)
                    animator.setState(state, at: 0)
                    var pose = MotePose()
                    for frame in 0...30 { pose = animator.step(at: 0.7 + Double(frame) / 60, pointer: CGVector(dx: 120, dy: 40)) }
                    var cellContext = context
                    cellContext.translateBy(x: CGFloat(column) * cell, y: CGFloat(row) * cell)
                    MoteRenderer.draw(pose, personality: mote, in: &cellContext, size: CGSize(width: cell, height: cell))
                }
            }
        }
        .frame(width: cell * CGFloat(states.count), height: cell * CGFloat(motes.count))
        .background(.black)

        let renderer = ImageRenderer(content: sheet)
        renderer.scale = 2
        let image = try #require(renderer.nsImage)
        let tiff = try #require(image.tiffRepresentation)
        let png = try #require(NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]))
        try png.write(to: dir.appendingPathComponent("motes-sheet.png"))
    }
}
