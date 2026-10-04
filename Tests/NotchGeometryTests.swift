import CoreGraphics
import Testing
@testable import Motes

struct NotchGeometryTests {
    let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)

    @Test func notchedScreen() {
        let g = NotchGeometry(
            screenFrame: screen, safeAreaTop: 32,
            auxiliaryLeftWidth: 664, auxiliaryRightWidth: 664, menuBarHeight: 37
        )
        #expect(g.hasNotch)
        #expect(g.notchSize == CGSize(width: 184, height: 32))
    }

    @Test func screenWithoutNotchUsesFallbackBar() {
        let g = NotchGeometry(
            screenFrame: screen, safeAreaTop: 0,
            auxiliaryLeftWidth: nil, auxiliaryRightWidth: nil, menuBarHeight: 24
        )
        #expect(!g.hasNotch)
        #expect(g.notchSize == CGSize(width: NotchGeometry.fallbackWidth, height: 24))
    }

    @Test func fallbackHeightIsCapped() {
        let g = NotchGeometry(
            screenFrame: screen, safeAreaTop: 0,
            auxiliaryLeftWidth: nil, auxiliaryRightWidth: nil, menuBarHeight: 40
        )
        #expect(g.notchSize.height == NotchGeometry.fallbackMaxHeight)
    }

    @Test func fallbackWhenMenuBarIsHidden() {
        let g = NotchGeometry(
            screenFrame: screen, safeAreaTop: 0,
            auxiliaryLeftWidth: nil, auxiliaryRightWidth: nil, menuBarHeight: 0
        )
        #expect(g.notchSize.height > 0)
    }

    @Test func safeAreaWithoutAuxiliaryAreasIsNotANotch() {
        let g = NotchGeometry(
            screenFrame: screen, safeAreaTop: 32,
            auxiliaryLeftWidth: nil, auxiliaryRightWidth: nil, menuBarHeight: 24
        )
        #expect(!g.hasNotch)
    }

    @Test func topCenteredRectOnSecondaryScreen() {
        let g = NotchGeometry(
            screenFrame: CGRect(x: 1512, y: 100, width: 1000, height: 800), safeAreaTop: 0,
            auxiliaryLeftWidth: nil, auxiliaryRightWidth: nil, menuBarHeight: 24
        )
        let rect = g.topCenteredRect(size: CGSize(width: 200, height: 50))
        #expect(rect == CGRect(x: 1912, y: 850, width: 200, height: 50))
    }
}
