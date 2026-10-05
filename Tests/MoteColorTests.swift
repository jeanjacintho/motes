import Testing
@testable import Motes

struct MoteColorTests {
    @Test func hex() {
        let c = MoteColor(hex: 0xFF8000)
        #expect(c.r == 1 && c.b == 0 && abs(c.g - 128.0 / 255) < 1e-9)
    }

    @Test func mixClamps() {
        let black = MoteColor(r: 0, g: 0, b: 0), white = MoteColor(r: 1, g: 1, b: 1)
        #expect(black.mixed(with: white, amount: 2) == white)
        #expect(black.mixed(with: white, amount: -1) == black)
        #expect(black.mixed(with: white, amount: 0.5).r == 0.5)
    }
}
