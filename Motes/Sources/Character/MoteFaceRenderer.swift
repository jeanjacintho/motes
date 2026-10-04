import SwiftUI

/// Ink eyes: rounded pills that lean, blink and follow the pointer.
/// Drawn in a context centred on the body.
enum MoteFaceRenderer {
    /// The face sits a touch below the middle of the orb.
    static let faceOffset = 0.06

    static func eyeCenters(eyes: MotePersonality.Eyes, radius: CGFloat) -> [(side: Double, center: CGPoint, scale: Double)] {
        [(-1, eyes.leftScale), (1, eyes.rightScale)].map { side, scale in
            (side, CGPoint(x: side * radius * eyes.spacing, y: radius * faceOffset), scale)
        }
    }

    static func drawEyes(_ pose: MotePose, eyes: MotePersonality.Eyes, radius: CGFloat, ink: Color, in context: inout GraphicsContext) {
        let wideScale = pose.eyeShape == .wide ? 1.18 : 1

        for (side, base, scale) in eyeCenters(eyes: eyes, radius: radius) {
            let w = radius * eyes.width * scale * wideScale
            let h = radius * eyes.height * scale * wideScale
            let lineWidth = max(1, min(w, h) * 0.5)
            // Half-width of arcs, lines and brows: never wider than the gap between eyes.
            let arc = min(w * 0.9, radius * eyes.spacing * 0.7)
            let angle = eyes.mirrored ? side * eyes.angle : eyes.angle

            var eye = context
            eye.translateBy(x: base.x + pose.gaze.dx * radius, y: base.y + pose.gaze.dy * radius)

            switch pose.eyeShape {
            case .open, .wide:
                eye.rotate(by: .radians(angle))
                let openH = max(h * pose.eyeOpenness, lineWidth * 0.7)
                pill(width: w, height: openH, y: 0, in: &eye, ink: ink)

            case .droopy:
                eye.rotate(by: .radians(angle))
                // Only the lower half shows: heavy lids.
                let openH = max(h * pose.eyeOpenness, lineWidth * 0.7)
                pill(width: w, height: openH, y: h / 2 - openH / 2, in: &eye, ink: ink)
                var brow = Path()
                brow.move(to: CGPoint(x: -side * arc, y: -h * 0.62))
                brow.addLine(to: CGPoint(x: side * arc, y: -h * 0.38))
                eye.stroke(brow, with: .color(ink), style: StrokeStyle(lineWidth: lineWidth * 0.7, lineCap: .round))

            case .happy:
                var curve = Path()
                curve.move(to: CGPoint(x: -arc, y: h * 0.1))
                curve.addQuadCurve(to: CGPoint(x: arc, y: h * 0.1), control: CGPoint(x: 0, y: -h * 0.5))
                eye.stroke(curve, with: .color(ink), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))

            case .flat:
                var line = Path()
                line.move(to: CGPoint(x: -arc, y: -side * h * 0.1))
                line.addLine(to: CGPoint(x: arc, y: side * h * 0.1))
                eye.stroke(line, with: .color(ink), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))

            case .closed:
                var curve = Path()
                curve.move(to: CGPoint(x: -arc, y: 0))
                curve.addQuadCurve(to: CGPoint(x: arc, y: 0), control: CGPoint(x: 0, y: h * 0.35))
                eye.stroke(curve, with: .color(ink), style: StrokeStyle(lineWidth: lineWidth * 0.8, lineCap: .round))
            }
        }
    }

    private static func pill(width: CGFloat, height: CGFloat, y: CGFloat, in context: inout GraphicsContext, ink: Color) {
        let rect = CGRect(x: -width / 2, y: y - height / 2, width: width, height: height)
        context.fill(Path(roundedRect: rect, cornerRadius: min(width, height) / 2), with: .color(ink))
    }
}
