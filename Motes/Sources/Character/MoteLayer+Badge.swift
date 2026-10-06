import AppKit
import QuartzCore

extension MoteLayer {
    // MARK: - Badge

    func installBadge(_ kind: MoteBadge?, color: MoteColor) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        badge.sublayers?.forEach { $0.removeFromSuperlayer() }
        badge.removeAllAnimations()
        guard let kind else { return }

        let r = radius
        let size = r * MoteBadgeLayout.sizeRatio
        let anchor = MoteBadgeLayout.anchor(for: kind, rx: r * personality.shape.width, ry: r * personality.shape.height)
        let point = CGPoint(x: center.x + anchor.x, y: center.y + anchor.y)

        switch kind {
        case .dots, .exclamation, .questionMark:
            let width = kind == .dots ? size * 2.7 : size * 2
            let bubble = CALayer()
            bubble.bounds = CGRect(x: 0, y: 0, width: width, height: size * 2)
            bubble.position = point
            bubble.cornerRadius = size
            bubble.backgroundColor = color.cg()
            bubble.borderColor = CGColor(gray: 0, alpha: 1)
            bubble.borderWidth = max(1, size * 0.18)
            badge.addSublayer(bubble)

            if kind == .dots {
                for index in 0..<3 {
                    let diameter = size * 0.42
                    let dot = CALayer()
                    dot.bounds = CGRect(x: 0, y: 0, width: diameter, height: diameter)
                    dot.cornerRadius = diameter / 2
                    dot.backgroundColor = CGColor(gray: 0, alpha: 1)
                    dot.position = CGPoint(x: width / 2 + CGFloat(index - 1) * size * 0.7, y: size)
                    let pulse = CAKeyframeAnimation(keyPath: "opacity")
                    pulse.values = [1, 0.45, 0.45]
                    pulse.keyTimes = [0, 1.0 / 3, 2.0 / 3, 1].map { NSNumber(value: $0) }
                    pulse.calculationMode = .discrete
                    pulse.duration = 1
                    pulse.repeatCount = .infinity
                    pulse.timeOffset = Double(2 - index) / 3
                    dot.add(pulse, forKey: "pulse")
                    bubble.addSublayer(dot)
                }
            } else {
                let glyph = text(kind == .exclamation ? "!" : "?", size: size * 1.4, color: CGColor(gray: 0, alpha: 1))
                glyph.position = CGPoint(x: width / 2, y: size)
                bubble.addSublayer(glyph)
            }

        case .sleep:
            // A "z" drifting up and fading, on a 2.4 s loop.
            let z = text("z", size: size * 1.6, color: CGColor(gray: 1, alpha: 1))
            z.position = point
            let drift = CABasicAnimation(keyPath: "position")
            drift.fromValue = point
            drift.toValue = CGPoint(x: point.x + size, y: point.y - size * 2)
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 1
            fade.toValue = 0
            let loop = CAAnimationGroup()
            loop.animations = [drift, fade]
            loop.duration = 2.4
            loop.repeatCount = .infinity
            z.add(loop, forKey: "sleep")
            badge.addSublayer(z)

        case .sweat:
            // A drop forming on the side of the head and sliding down, on a 2.2 s loop.
            let dropSize = r * 0.32
            let drop = CAShapeLayer()
            drop.path = MoteBadgeLayout.sweatDrop(size: dropSize)
            drop.fillColor = CGColor(srgbRed: 0.55, green: 0.82, blue: 1, alpha: 1)
            drop.position = point
            let slide = CABasicAnimation(keyPath: "position.y")
            slide.fromValue = point.y
            slide.toValue = point.y + r * 0.45
            let fade = CAKeyframeAnimation(keyPath: "opacity")
            fade.values = [0, 1, 1, 0]
            fade.keyTimes = [0, 0.15, 0.8, 1]
            let loop = CAAnimationGroup()
            loop.animations = [slide, fade]
            loop.duration = 2.2
            loop.repeatCount = .infinity
            drop.add(loop, forKey: "sweat")
            badge.addSublayer(drop)
        }
    }

    func text(_ string: String, size: CGFloat, color: CGColor) -> CATextLayer {
        let font = NSFont.systemFont(ofSize: size, weight: .heavy)
        let rounded = font.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: size) } ?? font
        let layer = CATextLayer()
        layer.string = NSAttributedString(string: string, attributes: [.font: rounded, .foregroundColor: color])
        layer.alignmentMode = .center
        layer.contentsScale = contentsScale
        let height = ceil(rounded.ascender - rounded.descender)
        layer.bounds = CGRect(x: 0, y: 0, width: size * 1.4, height: height)
        return layer
    }
}


/// Badge geometry, shared by the layer and its tests.
enum MoteBadgeLayout {
    /// Size of the badge relative to the mote's base radius.
    static let sizeRatio = 0.42

    /// Where each badge sits relative to the center: bubbles just above the
    /// head on the right, sweat on the side of the forehead.
    static func anchor(for badge: MoteBadge, rx: CGFloat, ry: CGFloat) -> CGPoint {
        switch badge {
        case .sweat: CGPoint(x: rx * 0.85, y: -ry * 0.75)
        case .sleep: CGPoint(x: rx * 0.55, y: -ry * 1.05)
        case .dots, .exclamation, .questionMark: CGPoint(x: rx * 0.78, y: -ry * 1.1)
        }
    }

    /// Teardrop with its point up, centered on the round part.
    static func sweatDrop(size: CGFloat) -> CGPath {
        let path = CGMutablePath()
        let r = size / 2
        path.move(to: CGPoint(x: 0, y: -size))
        path.addQuadCurve(to: CGPoint(x: r, y: 0), control: CGPoint(x: r * 0.9, y: -r))
        path.addArc(center: .zero, radius: r, startAngle: 0, endAngle: .pi, clockwise: false)
        path.addQuadCurve(to: CGPoint(x: 0, y: -size), control: CGPoint(x: -r * 0.9, y: -r))
        path.closeSubpath()
        return path
    }
}
