import SwiftUI

/// Status marks around the head, drawn in a context centred on the body.
enum MoteBadgeRenderer {
    /// Size of the badge relative to the mote's base radius.
    static let sizeRatio = 0.42

    /// Where each badge sits: bubbles just above the head, sweat on the side of the forehead.
    static func anchor(for badge: MoteBadge, rx: CGFloat, ry: CGFloat) -> CGPoint {
        switch badge {
        case .sweat: CGPoint(x: rx * 0.85, y: -ry * 0.75)
        case .sleep: CGPoint(x: rx * 0.55, y: -ry * 1.05)
        case .dots, .exclamation, .questionMark: CGPoint(x: rx * 0.78, y: -ry * 1.1)
        }
    }

    static func draw(_ badge: MoteBadge, phase: Double, color: Color, at point: CGPoint, radius: CGFloat, in context: inout GraphicsContext) {
        let r = radius * sizeRatio
        switch badge {
        case .sleep:
            // A "z" drifting up and fading, on a 2.4 s loop.
            let t = phase.truncatingRemainder(dividingBy: 2.4) / 2.4
            let text = Text("z").font(.system(size: r * 1.6, weight: .heavy, design: .rounded)).foregroundColor(.white)
            var z = context
            z.opacity = 1 - t
            z.draw(text, at: CGPoint(x: point.x + t * r, y: point.y - t * r * 2))

        case .sweat:
            // A drop forming on the side of the head and sliding down, on a 2.2 s loop.
            let t = phase.truncatingRemainder(dividingBy: 2.2) / 2.2
            let size = radius * 0.32
            let origin = CGPoint(x: point.x, y: point.y + t * radius * 0.45)
            var drop = context
            drop.opacity = t < 0.15 ? t / 0.15 : (t > 0.8 ? (1 - t) / 0.2 : 1)
            drop.fill(sweatDrop(at: origin, size: size), with: .color(Color(.sRGB, red: 0.55, green: 0.82, blue: 1)))

        case .dots, .exclamation, .questionMark:
            // A round bubble, stretched into a pill for the "busy" dots.
            let width = badge == .dots ? r * 2.7 : r * 2
            let rect = CGRect(x: point.x - width / 2, y: point.y - r, width: width, height: r * 2)
            let bubble = Path(roundedRect: rect, cornerRadius: r)
            context.fill(bubble, with: .color(color))
            context.stroke(bubble, with: .color(.black), lineWidth: max(1, r * 0.18))
            if badge == .dots {
                for i in 0..<3 {
                    let lit = Int(phase * 3) % 3 == i
                    let d = r * 0.42
                    let x = point.x + Double(i - 1) * r * 0.7
                    context.fill(Path(ellipseIn: CGRect(x: x - d / 2, y: point.y - d / 2, width: d, height: d)),
                                 with: .color(.black.opacity(lit ? 1 : 0.45)))
                }
            } else {
                let glyph = badge == .exclamation ? "!" : "?"
                let text = Text(glyph).font(.system(size: r * 1.4, weight: .heavy, design: .rounded)).foregroundColor(.black)
                context.draw(text, at: point)
            }
        }
    }

    /// Teardrop with its point up, `origin` at the center of the round part.
    private static func sweatDrop(at origin: CGPoint, size: CGFloat) -> Path {
        var path = Path()
        let r = size / 2
        path.move(to: CGPoint(x: origin.x, y: origin.y - size))
        path.addQuadCurve(to: CGPoint(x: origin.x + r, y: origin.y), control: CGPoint(x: origin.x + r * 0.9, y: origin.y - r))
        path.addArc(center: origin, radius: r, startAngle: .zero, endAngle: .degrees(180), clockwise: false)
        path.addQuadCurve(to: CGPoint(x: origin.x, y: origin.y - size), control: CGPoint(x: origin.x - r * 0.9, y: origin.y - r))
        path.closeSubpath()
        return path
    }
}
