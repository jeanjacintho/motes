import AppKit
import QuartzCore

/// A mote drawn with Core Animation. Its life (breathing, orbit, blinks, badges,
/// hops) runs as repeating animations in the render server, so the app does no
/// work between frames: it only reconfigures layers when the state changes, and
/// moves the eyes when the pointer moves.
///
/// Coordinates are flipped (y grows downwards), lengths are in units of the
/// mote's base radius, like the style in `docs/PROJECT.md` §3.2.
///
/// Split by subject: orbit in `MoteLayer+Orbit`, eyes in `MoteLayer+Eyes`,
/// badges in `MoteLayer+Badge`.
final class MoteLayer: CALayer {
    private(set) var personality: MotePersonality
    private(set) var state: MoteState = .idle

    /// Base radius as a fraction of the shortest side. The rest is room for
    /// the halo, the orbit and the badge.
    static let radiusRatio = 0.24

    // Back to front. `motion` carries state movement, `breath` the breathing scale.
    let halo = CAGradientLayer()
    let stateHalo = CAGradientLayer()
    let motion = CALayer()
    let breath = CALayer()
    let body = CAGradientLayer()
    let eyes = CALayer()
    var eyeLayers: [Eye] = []
    var particles: [CALayer] = []
    let badge = CALayer()

    /// One eye: `pivot` holds the lean, `lid` blinks, the shapes draw it.
    struct Eye {
        let side: CGFloat
        let pivot = CALayer()
        let lid = CALayer()
        let fill = CAShapeLayer()
        let stroke = CAShapeLayer()
    }

    var radius: CGFloat = 0
    var center: CGPoint = .zero
    var builtSize: CGSize = .zero
    var pointer: CGVector?

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

    var textLayers: [CATextLayer] {
        badge.sublayers?.flatMap { [$0] + ($0.sublayers ?? []) }.compactMap { $0 as? CATextLayer } ?? []
    }

    func rebuild() {
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

    func configureRadial(_ layer: CAGradientLayer, center: CGPoint, radius: CGFloat,
                                 colors: [CGColor], locations: [NSNumber]) {
        layer.type = .radial
        layer.frame = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
        layer.startPoint = CGPoint(x: 0.5, y: 0.5)
        layer.endPoint = CGPoint(x: 1, y: 1)
        layer.colors = colors
        layer.locations = locations
    }

    // MARK: - State

    func applyState(from previous: MoteState?, animated: Bool) {
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

    func installBreathing() {
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
    func installMotion(entering: Bool) {
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
}
