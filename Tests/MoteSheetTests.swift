import AppKit
import QuartzCore
import Testing
@testable import Motes

/// Renders every mote in every state to a PNG, for eyeballing the style.
/// Animations aren't captured: each mote is drawn at rest.
/// Runs only when MOTES_RENDER_DIR is set:
///   TEST_RUNNER_MOTES_RENDER_DIR=/some/dir xcodebuild -scheme Motes test
@MainActor
struct MoteSheetTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["MOTES_RENDER_DIR"] != nil))
    func renderSheet() throws {
        let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["MOTES_RENDER_DIR"]!)
        let cell = 120, scale = 2
        let states = MoteState.allCases
        let motes = MoteRegistry.all
        let width = cell * states.count * scale, height = cell * motes.count * scale

        let context = try #require(CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        // Top-left origin, like the screen.
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: CGFloat(scale), y: -CGFloat(scale))

        for (row, mote) in motes.enumerated() {
            for (column, state) in states.enumerated() {
                let layer = MoteLayer(personality: mote)
                layer.contentsScale = CGFloat(scale)
                layer.frame = CGRect(x: 0, y: 0, width: cell, height: cell)
                layer.layoutIfNeeded()
                layer.apply(state)
                context.saveGState()
                context.translateBy(x: CGFloat(column * cell), y: CGFloat(row * cell))
                layer.render(in: context)
                context.restoreGState()
            }
        }
        let image = try #require(context.makeImage())
        let png = try #require(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
        try png.write(to: dir.appendingPathComponent("motes-sheet.png"))
    }
}
