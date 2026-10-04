import SwiftUI

/// Island outline: square top flowing into the screen edge through two concave
/// shoulders, rounded bottom corners. The body is inset by `shoulderRadius` on each side.
struct IslandShape: Shape {
    var bottomRadius: CGFloat
    var shoulderRadius: CGFloat

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(bottomRadius, shoulderRadius) }
        set { bottomRadius = newValue.first; shoulderRadius = newValue.second }
    }

    func path(in rect: CGRect) -> Path {
        let s = min(shoulderRadius, rect.height / 2)
        let left = rect.minX + s
        let right = rect.maxX - s
        let r = max(0, min(bottomRadius, (right - left) / 2, rect.height - s))

        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addQuadCurve(to: CGPoint(x: left, y: rect.minY + s), control: CGPoint(x: left, y: rect.minY))
        path.addLine(to: CGPoint(x: left, y: rect.maxY - r))
        path.addQuadCurve(to: CGPoint(x: left + r, y: rect.maxY), control: CGPoint(x: left, y: rect.maxY))
        path.addLine(to: CGPoint(x: right - r, y: rect.maxY))
        path.addQuadCurve(to: CGPoint(x: right, y: rect.maxY - r), control: CGPoint(x: right, y: rect.maxY))
        path.addLine(to: CGPoint(x: right, y: rect.minY + s))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY), control: CGPoint(x: right, y: rect.minY))
        path.closeSubpath()
        return path
    }
}
