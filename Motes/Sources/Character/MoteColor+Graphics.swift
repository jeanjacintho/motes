import CoreGraphics
import SwiftUI

extension MoteColor {
    var color: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: a) }

    func cg(alpha: Double? = nil) -> CGColor {
        CGColor(srgbRed: r, green: g, blue: b, alpha: alpha ?? a)
    }
}
