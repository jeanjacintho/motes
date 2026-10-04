import SwiftUI

/// Draws a pose: an orb of light in the mote's color, a soft halo, dust orbiting
/// in front of and behind it, a face, and the state as a second halo and a badge.
enum MoteRenderer {
    /// Base radius as a fraction of the canvas' shortest side. The rest is room
    /// for the halo, the orbit and the badge.
    static let radiusRatio = 0.24

    static func draw(_ pose: MotePose, personality: MotePersonality, in context: inout GraphicsContext, size: CGSize) {
        let radius = min(size.width, size.height) * radiusRatio
        let center = CGPoint(
            x: size.width / 2 + pose.offset.dx * radius,
            y: size.height / 2 + pose.offset.dy * radius
        )
        let color = personality.color.color
        let rx = radius * personality.shape.width * pose.scaleX
        let ry = radius * personality.shape.height * pose.scaleY

        // The mote's own light, breathing with the body.
        let halo = radius * 2.1 * pose.scaleY
        fillCircle(center: center, radius: halo, in: &context, with: .radialGradient(
            Gradient(colors: [color.opacity(0.42), color.opacity(0.1), .clear]),
            center: center, startRadius: radius * 0.6, endRadius: halo
        ))
        // State halo.
        if pose.glow > 0.01 {
            fillCircle(center: center, radius: radius * 1.9, in: &context, with: .radialGradient(
                Gradient(colors: [pose.stateColor.color.opacity(pose.glow * 0.8), .clear]),
                center: center, startRadius: radius * 0.8, endRadius: radius * 1.9
            ))
        }

        let dust = dustPositions(pose, orbit: personality.orbit, center: center, radius: radius)
        let dustColor = personality.coreColor.color
        for particle in dust where !particle.inFront {
            drawParticle(particle, color: dustColor, brightness: pose.dust * 0.7, in: &context)
        }

        // Body: bright core, off-center like a light source, fading to the mote's color.
        var body = context
        body.translateBy(x: center.x, y: center.y)
        body.rotate(by: .radians(pose.tilt))
        body.fill(Path(ellipseIn: CGRect(x: -rx, y: -ry, width: rx * 2, height: ry * 2)), with: .radialGradient(
            Gradient(colors: [personality.coreColor.color, color, color.opacity(0.88)]),
            center: CGPoint(x: -rx * 0.25, y: -ry * 0.3), startRadius: 0, endRadius: radius * 1.15
        ))
        MoteFaceRenderer.drawEyes(pose, eyes: personality.eyes, radius: radius,
                                  ink: personality.inkColor.color, in: &body)

        for particle in dust where particle.inFront {
            drawParticle(particle, color: dustColor, brightness: pose.dust, in: &context)
        }

        if let badge = pose.badge {
            var badgeContext = context
            badgeContext.translateBy(x: center.x, y: center.y)
            MoteBadgeRenderer.draw(badge, phase: pose.phase, color: pose.stateColor.color,
                                   at: MoteBadgeRenderer.anchor(for: badge, rx: rx, ry: ry),
                                   radius: radius, in: &badgeContext)
        }
    }

    struct Particle {
        var point: CGPoint
        var radius: CGFloat
        var inFront: Bool
    }

    /// Dust on a tilted, flattened circle around the body. Particles on the near
    /// half of the orbit are in front of the body and slightly bigger.
    static func dustPositions(_ pose: MotePose, orbit: MotePersonality.Orbit, center: CGPoint, radius: CGFloat) -> [Particle] {
        guard orbit.particles > 0 else { return [] }
        return (0..<orbit.particles).map { i in
            let angle = pose.orbitAngle + Double(i) * 2 * .pi / Double(orbit.particles)
            // Each particle wanders a little in and out so the ring feels alive.
            let wander = 1 + 0.12 * sin(pose.phase * 0.9 + Double(i) * 1.7)
            let x = cos(angle) * orbit.radius * wander
            let y = sin(angle) * orbit.radius * wander * orbit.flatten
            let depth = sin(angle)
            let tx = x * cos(orbit.tilt) - y * sin(orbit.tilt)
            let ty = x * sin(orbit.tilt) + y * cos(orbit.tilt)
            let size = orbit.particleSize * (1 + 0.3 * depth) * (i % 2 == 0 ? 1 : 0.75)
            return Particle(
                point: CGPoint(x: center.x + tx * radius, y: center.y + ty * radius),
                radius: radius * size,
                inFront: depth > 0
            )
        }
    }

    private static func drawParticle(_ particle: Particle, color: Color, brightness: Double, in context: inout GraphicsContext) {
        let glow = particle.radius * 2.6
        fillCircle(center: particle.point, radius: glow, in: &context, with: .radialGradient(
            Gradient(colors: [color.opacity(brightness * 0.45), .clear]),
            center: particle.point, startRadius: 0, endRadius: glow
        ))
        fillCircle(center: particle.point, radius: particle.radius, in: &context, with: .color(color.opacity(brightness)))
    }

    private static func fillCircle(center: CGPoint, radius: CGFloat, in context: inout GraphicsContext, with shading: GraphicsContext.Shading) {
        context.fill(Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)), with: shading)
    }
}

extension MoteColor {
    var color: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: a) }
}
