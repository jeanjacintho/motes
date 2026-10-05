import AppKit
import QuartzCore

/// A mote drawn with Core Animation. Its life (breathing, orbit, blinks, badges,
/// hops) runs as repeating animations in the render server, so the app does no
/// work between frames: it only reconfigures layers when the state changes, and
/// moves the eyes when the pointer moves.
///
/// Coordinates are flipped (y grows downwards), lengths are in units of the
/// mote's base radius, like the style in `docs/PROJECT.md` §3.2.
final class MoteLayer: CALayer {
    private(set) var personality: MotePersonality
    private(set) var state: MoteState = .idle

    /// Base radius as a fraction of the shortest side. The rest is room for
    /// the halo, the orbit and the badge.
    static let radiusRatio = 0.24

    // Back to front. `motion` carries state movement, `breath` the breathing scale.
    private let halo = CAGradientLayer()
    private let stateHalo = CAGradientLayer()
    private let motion = CALayer()
    private let breath = CALayer()
    private let body = CAGradientLayer()
    private let eyes = CALayer()
    private var eyeLayers: [Eye] = []
    private var particles: [CALayer] = []
    private let badge = CALayer()

    /// One eye: `pivot` holds the lean, `lid` blinks, the shapes draw it.
    private struct Eye {
        let side: CGFloat
        let pivot = CALayer()
        let lid = CALayer()
        let fill = CAShapeLayer()
        let stroke = CAShapeLayer()
    }

    private var radius: CGFloat = 0
    private var center: CGPoint = .zero
    private var builtSize: CGSize = .zero
    private var pointer: CGVector?

    init(personality: MotePersonality) {
        self.personality = personality
        super.init()
        isGeometryFlipped = true
    }

    /// Used by Core Animation for presentation copies.
    override init(layer: Any) {
        let other = layer as? MoteLayer
        personality = other?.personality ?? .default
        state = other?.state ?? .idle
        super.init(layer: layer)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override var contentsScale: CGFloat {
        didSet { for text in textLayers { text.contentsScale = contentsScale } }
    }

    // MARK: - Public

    func configure(personality: MotePersonality) {
        guard personality != self.personality else { return }
        self.personality = personality
        rebuild()
    }

    func apply(_ newState: MoteState) {
        guard newState != state else { return }
        let previous = state
        state = newState
        guard radius > 0 else { return }
        applyState(from: previous, animated: true)
    }

    /// Pointer position relative to the mote's center, in points, y downwards;
    /// `nil` when unknown. Only the eyes move.
    func pointerMoved(_ offset: CGVector?) {
        pointer = offset
        updateGaze(animated: true)
    }

    override func layoutSublayers() {
        super.layoutSublayers()
        if bounds.size != builtSize { rebuild() }
    }

    // MARK: - Building

    private var textLayers: [CATextLayer] {
        badge.sublayers?.flatMap { [$0] + ($0.sublayers ?? []) }.compactMap { $0 as? CATextLayer } ?? []
    }

    private func rebuild() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }

        sublayers?.forEach { $0.removeFromSuperlayer() }
        motion.sublayers?.forEach { $0.removeFromSuperlayer() }
        breath.sublayers?.forEach { $0.removeFromSuperlayer() }
        eyes.sublayers?.forEach { $0.removeFromSuperlayer() }
        particles = []
        eyeLayers = []
        builtSize = bounds.size
        guard bounds.width > 0, bounds.height > 0 else { return }

        radius = min(bounds.width, bounds.height) * Self.radiusRatio
        center = CGPoint(x: bounds.midX, y: bounds.midY)
        let r = radius
        let color = personality.color

        // Halo: the mote's own light.
        configureRadial(halo, center: center, radius: r * 2.1,
                        colors: [color.cg(alpha: 0.42), color.cg(alpha: 0.1), color.cg(alpha: 0)],
                        locations: [0.29, 0.6, 1])
        halo.zPosition = -2
        addSublayer(halo)

        // State halo: color and strength set per state.
        configureRadial(stateHalo, center: center, radius: r * 1.9, colors: [], locations: [0.42, 1])
        stateHalo.zPosition = -1
        addSublayer(stateHalo)

        for layer in [motion, breath, eyes] {
            layer.frame = bounds
            layer.transform = CATransform3DIdentity
            layer.removeAllAnimations()
        }
        addSublayer(motion)
        motion.addSublayer(breath)

        // Body: bright core, off-center like a light source, fading to the mote's color.
        let rx = r * personality.shape.width, ry = r * personality.shape.height
        body.type = .radial
        body.frame = CGRect(x: center.x - rx, y: center.y - ry, width: rx * 2, height: ry * 2)
        body.cornerRadius = min(rx, ry)
        body.masksToBounds = true
        body.colors = [personality.coreColor.cg(), color.cg(), color.cg(alpha: 0.88)]
        body.locations = [0, 0.55, 1]
        let start = CGPoint(x: 0.375, y: 0.35)
        body.startPoint = start
        body.endPoint = CGPoint(x: start.x + 0.575 / personality.shape.width, y: start.y + 0.575 / personality.shape.height)
        breath.addSublayer(body)

        breath.addSublayer(eyes)
        for side in [-1.0, 1.0] as [CGFloat] {
            let eye = Eye(side: side)
            eye.pivot.addSublayer(eye.lid)
            eye.lid.addSublayer(eye.fill)
            eye.lid.addSublayer(eye.stroke)
            eye.stroke.fillColor = nil
            eye.stroke.lineCap = .round
            let ink = personality.inkColor.cg()
            eye.fill.fillColor = ink
            eye.stroke.strokeColor = ink
            eyes.addSublayer(eye.pivot)
            eyeLayers.append(eye)
        }

        buildParticles()
        motion.addSublayer(badge)

        applyState(from: nil, animated: false)
    }

    private func configureRadial(_ layer: CAGradientLayer, center: CGPoint, radius: CGFloat,
                                 colors: [CGColor], locations: [NSNumber]) {
        layer.type = .radial
        layer.frame = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
        layer.startPoint = CGPoint(x: 0.5, y: 0.5)
        layer.endPoint = CGPoint(x: 1, y: 1)
        layer.colors = colors
        layer.locations = locations
    }

    // MARK: - Orbit

    private func buildParticles() {
        let orbit = personality.orbit
        guard orbit.particles > 0 else { return }
        let core = personality.coreColor
        let path = Self.orbitPath(center: center, radius: radius * orbit.radius,
                                  flatten: orbit.flatten, tilt: orbit.tilt)
        let duration = 2 * .pi / max(orbit.speed, 0.01)

        for index in 0..<orbit.particles {
            let size = radius * orbit.particleSize * (index % 2 == 0 ? 1 : 0.75)
            let particle = CALayer()
            particle.bounds = CGRect(x: 0, y: 0, width: size * 2, height: size * 2)
            particle.cornerRadius = size
            particle.backgroundColor = core.cg()
            // Resting point on the ring, in case the orbit animation isn't running.
            let rest = orbit.radius * radius
            particle.position = CGPoint(x: center.x + rest * cos(orbit.tilt), y: center.y + rest * sin(orbit.tilt))

            let glow = CAGradientLayer()
            configureRadial(glow, center: CGPoint(x: size, y: size), radius: size * 2.6,
                            colors: [core.cg(alpha: 0.45), core.cg(alpha: 0)], locations: [0, 1])
            particle.addSublayer(glow)

            // One loop of the orbit; each particle starts at its own phase.
            let phase = duration * Double(index) / Double(orbit.particles)
            let move = CAKeyframeAnimation(keyPath: "position")
            move.path = path
            move.calculationMode = .paced

            // Near half of the ring (lower on screen) passes in front of the body.
            let depth = CAKeyframeAnimation(keyPath: "zPosition")
            depth.values = [1, -1]
            depth.keyTimes = [0, 0.5, 1]
            depth.calculationMode = .discrete

            let scale = CAKeyframeAnimation(keyPath: "transform.scale")
            scale.values = [1, 1.3, 1, 0.7, 1]
            scale.keyTimes = [0, 0.25, 0.5, 0.75, 1]

            let loop = CAAnimationGroup()
            loop.animations = [move, depth, scale]
            loop.duration = duration
            loop.repeatCount = .infinity
            loop.timeOffset = phase
            particle.add(loop, forKey: "orbit")

            addSublayer(particle)
            particles.append(particle)
        }
    }

    /// The orbit ring: a flattened, tilted ellipse around `center`, starting on
    /// the right and going through the near (lower) half first.
    static func orbitPath(center: CGPoint, radius: CGFloat, flatten: Double, tilt: Double) -> CGPath {
        let path = CGMutablePath()
        let steps = 72
        for step in 0...steps {
            let angle = Double(step) / Double(steps) * 2 * .pi
            let x = cos(angle) * radius
            let y = sin(angle) * radius * flatten
            let point = CGPoint(x: center.x + x * cos(tilt) - y * sin(tilt),
                                y: center.y + x * sin(tilt) + y * cos(tilt))
            step == 0 ? path.move(to: point) : path.addLine(to: point)
        }
        path.closeSubpath()
        return path
    }

    /// Changes how fast a layer's animations run without making them jump.
    private static func setSpeed(_ layer: CALayer, _ speed: Float) {
        guard layer.speed != speed else { return }
        let now = CACurrentMediaTime()
        layer.timeOffset = layer.convertTime(now, from: nil)
        layer.beginTime = now
        layer.speed = speed
    }

    // MARK: - State

    private func applyState(from previous: MoteState?, animated: Bool) {
        let style = MoteStateStyle.of(state)
        let r = radius

        CATransaction.begin()
        CATransaction.setDisableActions(!animated)
        CATransaction.setAnimationDuration(0.35)

        // State light.
        stateHalo.colors = [style.color.cg(alpha: 0.8), style.color.cg(alpha: 0)]
        stateHalo.opacity = Float(style.glow)

        // Dust: brightness and speed.
        for particle in particles {
            particle.opacity = Float(style.dust)
            Self.setSpeed(particle, Float(style.orbitSpeed))
        }

        // Resting pose of the body: a sag when tired, a tilt when asking.
        var pose = CATransform3DIdentity
        switch state {
        case .tired:
            pose = CATransform3DTranslate(pose, 0, r * 0.04, 0)
            pose = CATransform3DScale(pose, 1.03, 0.96, 1)
        case .question:
            pose = CATransform3DRotate(pose, 0.16, 0, 0, 1)
        default:
            break
        }
        motion.transform = pose
        CATransaction.commit()

        installBreathing()
        installMotion(entering: previous != state)
        drawEyes(style.eyes)
        installBadge(style.badge, color: style.color)
        updateGaze(animated: animated)
    }

    private func installBreathing() {
        var period = personality.motion.breathPeriod
        var amount = personality.motion.breathAmount
        switch state {
        case .working, .thinking: period *= 0.7
        case .tired: period *= 1.3; amount *= 1.5
        case .sleeping: period *= 1.6; amount *= 1.6
        default: break
        }
        let breathe = CABasicAnimation(keyPath: "transform")
        breathe.fromValue = CATransform3DMakeScale(1 + amount * 0.5, 1 - amount, 1)
        breathe.toValue = CATransform3DMakeScale(1 - amount * 0.5, 1 + amount, 1)
        breathe.duration = period / 2
        breathe.autoreverses = true
        breathe.repeatCount = .infinity
        breathe.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        breath.add(breathe, forKey: "breath")
    }

    /// Movement that belongs to a state: a loop (working, approval) or a one-off on entry (error, finished).
    private func installMotion(entering: Bool) {
        motion.removeAnimation(forKey: "state")
        let r = radius
        let energy = personality.motion.energy
        switch state {
        case .working:
            let bob = CABasicAnimation(keyPath: "transform.translation.y")
            bob.fromValue = -r * 0.02 * energy
            bob.toValue = r * 0.02 * energy
            bob.duration = 0.45
            bob.autoreverses = true
            bob.repeatCount = .infinity
            bob.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            motion.add(bob, forKey: "state")
        case .approval:
            let hop = CAKeyframeAnimation(keyPath: "transform.translation.y")
            hop.values = [0, -r * 0.1 * energy, 0]
            hop.keyTimes = [0, 0.5, 1]
            hop.timingFunctions = [CAMediaTimingFunction(name: .easeOut), CAMediaTimingFunction(name: .easeIn)]
            hop.duration = 1.1
            hop.repeatCount = .infinity
            motion.add(hop, forKey: "state")
        case .error where entering:
            let shake = CAKeyframeAnimation(keyPath: "transform.translation.x")
            let amplitude = r * 0.08 * energy
            shake.values = [0, amplitude, -amplitude * 0.8, amplitude * 0.55, -amplitude * 0.3, amplitude * 0.1, 0]
            shake.duration = 0.45
            motion.add(shake, forKey: "state")
        case .finished where entering:
            let hop = CAKeyframeAnimation(keyPath: "transform.translation.y")
            hop.values = [0, -r * 0.22 * energy, 0]
            hop.keyTimes = [0, 0.45, 1]
            hop.timingFunctions = [CAMediaTimingFunction(name: .easeOut), CAMediaTimingFunction(name: .easeIn)]
            hop.duration = 0.6
            motion.add(hop, forKey: "state")
        default:
            break
        }
    }

    // MARK: - Eyes

    private func drawEyes(_ shape: MoteEyeShape) {
        let traits = personality.eyes
        let r = radius
        let wide: CGFloat = shape == .wide ? 1.18 : 1

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for eye in eyeLayers {
            let scale = eye.side < 0 ? traits.leftScale : traits.rightScale
            let w = r * traits.width * scale * wide
            let h = r * traits.height * scale * wide
            let line = max(1, min(w, h) * 0.5)
            // Arcs and brows never reach across to the other eye.
            let arc = min(w * 0.9, r * traits.spacing * 0.7)
            let leans = shape == .open || shape == .wide || shape == .droopy
            let angle = traits.mirrored ? eye.side * traits.angle : traits.angle

            eye.pivot.bounds = CGRect(x: -w, y: -h, width: w * 2, height: h * 2)
            eye.pivot.position = CGPoint(x: center.x + eye.side * r * traits.spacing, y: center.y + r * 0.06)
            eye.pivot.transform = CATransform3DMakeRotation(leans ? angle : 0, 0, 0, 1)
            eye.lid.frame = eye.pivot.bounds
            eye.lid.bounds = eye.pivot.bounds
            eye.fill.frame = eye.lid.bounds
            eye.fill.bounds = eye.lid.bounds
            eye.stroke.frame = eye.lid.bounds
            eye.stroke.bounds = eye.lid.bounds

            var fill: CGPath?
            let stroke = CGMutablePath()
            var strokeWidth = line
            switch shape {
            case .open, .wide:
                fill = CGPath(roundedRect: CGRect(x: -w / 2, y: -h / 2, width: w, height: h),
                              cornerWidth: min(w, h) / 2, cornerHeight: min(w, h) / 2, transform: nil)
            case .droopy:
                // Heavy lids: only the lower part shows, under a sad brow.
                let open = max(h * 0.45, line * 0.7)
                fill = CGPath(roundedRect: CGRect(x: -w / 2, y: h / 2 - open, width: w, height: open),
                              cornerWidth: min(w, open) / 2, cornerHeight: min(w, open) / 2, transform: nil)
                stroke.move(to: CGPoint(x: -eye.side * arc, y: -h * 0.62))
                stroke.addLine(to: CGPoint(x: eye.side * arc, y: -h * 0.38))
                strokeWidth = line * 0.7
            case .happy:
                stroke.move(to: CGPoint(x: -arc, y: h * 0.1))
                stroke.addQuadCurve(to: CGPoint(x: arc, y: h * 0.1), control: CGPoint(x: 0, y: -h * 0.5))
            case .flat:
                stroke.move(to: CGPoint(x: -arc, y: -eye.side * h * 0.1))
                stroke.addLine(to: CGPoint(x: arc, y: eye.side * h * 0.1))
            case .closed:
                stroke.move(to: CGPoint(x: -arc, y: 0))
                stroke.addQuadCurve(to: CGPoint(x: arc, y: 0), control: CGPoint(x: 0, y: h * 0.35))
                strokeWidth = line * 0.8
            }
            eye.fill.path = fill
            eye.stroke.path = stroke.isEmpty ? nil : stroke
            eye.stroke.lineWidth = strokeWidth
            // Only open eyes blink; others drop the animation rather than freeze mid-blink.
            if leans {
                if eye.lid.animation(forKey: "blink") == nil { eye.lid.add(blinkAnimation(), forKey: "blink") }
            } else {
                eye.lid.removeAnimation(forKey: "blink")
            }
        }
        CATransaction.commit()
    }

    private func blinkAnimation() -> CAAnimation {
        let traits = personality.eyes
        let rhythm = MoteBlink.make(interval: traits.blinkInterval, doubleChance: traits.doubleBlinkChance,
                                    seed: MoteBlink.seed(for: personality.id))
        let blink = CAKeyframeAnimation(keyPath: "transform.scale.y")
        blink.values = rhythm.values
        blink.keyTimes = rhythm.keyTimes.map { NSNumber(value: $0) }
        blink.duration = rhythm.period
        blink.repeatCount = .infinity
        return blink
    }

    /// Where the eyes look: the pointer, or somewhere fixed in some states.
    private func updateGaze(animated: Bool) {
        let motion = personality.motion
        var target = CGVector.zero
        switch state {
        case .thinking:
            target = CGVector(dx: 0.6, dy: -0.6)
        case .sleeping:
            target = CGVector(dx: 0, dy: 0.3)
        case .tired:
            target = CGVector(dx: pointer.map { tanh($0.dx / 260) * 0.3 } ?? 0, dy: 0.55)
        default:
            if let pointer { target = CGVector(dx: tanh(pointer.dx / 260), dy: tanh(pointer.dy / 200)) }
        }
        let offset = CGPoint(x: target.dx * motion.gazeReach * radius, y: target.dy * motion.gazeReach * radius)
        let position = CGPoint(x: bounds.midX + offset.x, y: bounds.midY + offset.y)
        guard position != eyes.position else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(!animated)
        // Snappier personalities catch up faster.
        CATransaction.setAnimationDuration(1.6 / max(motion.gazeResponsiveness, 1))
        CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .easeOut))
        eyes.position = position
        CATransaction.commit()
    }

    // MARK: - Badge

    private func installBadge(_ kind: MoteBadge?, color: MoteColor) {
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

    private func text(_ string: String, size: CGFloat, color: CGColor) -> CATextLayer {
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
