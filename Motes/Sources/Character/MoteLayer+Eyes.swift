import QuartzCore

extension MoteLayer {
    // MARK: - Eyes

    func drawEyes(_ shape: MoteEyeShape) {
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

    func blinkAnimation() -> CAAnimation {
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
    func updateGaze(animated: Bool) {
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
}
