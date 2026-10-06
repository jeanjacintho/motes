import QuartzCore

extension MoteLayer {
    // MARK: - Orbit

    func buildParticles() {
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
    static func setSpeed(_ layer: CALayer, _ speed: Float) {
        guard layer.speed != speed else { return }
        let now = CACurrentMediaTime()
        layer.timeOffset = layer.convertTime(now, from: nil)
        layer.beginTime = now
        layer.speed = speed
    }
}
