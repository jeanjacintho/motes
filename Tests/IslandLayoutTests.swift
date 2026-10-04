import CoreGraphics
import Testing
@testable import Motes

struct IslandLayoutTests {
    let notch = CGSize(width: 184, height: 32)

    @Test func hiddenMatchesTheNotch() {
        #expect(IslandLayout.size(for: .hidden, notch: notch) == notch)
    }

    @Test func compactAddsBothSides() {
        let size = IslandLayout.size(for: .compact, notch: notch)
        #expect(size.width == notch.width + IslandLayout.compactSideWidth * 2)
        #expect(size.height == notch.height)
    }

    @Test func expandedIsNeverSmallerThanCompact() {
        let wide = CGSize(width: 600, height: 40)
        let expanded = IslandLayout.size(for: .expanded, notch: wide)
        let compact = IslandLayout.size(for: .compact, notch: wide)
        #expect(expanded.width >= compact.width)
        #expect(expanded.height >= compact.height)
    }

    @Test func everyModeFitsInThePanel() {
        for mode in [IslandMode.hidden, .compact, .expanded] {
            let size = IslandLayout.size(for: mode, notch: notch)
            #expect(size.width + IslandLayout.shoulderRadius * 2 <= IslandLayout.panelSize.width)
            #expect(size.height <= IslandLayout.panelSize.height)
        }
    }

    @Test func hiddenIsInvisibleOnlyWithoutNotch() {
        #expect(IslandLayout.isVisible(.hidden, hasNotch: true))
        #expect(!IslandLayout.isVisible(.hidden, hasNotch: false))
        #expect(IslandLayout.isVisible(.compact, hasNotch: false))
    }

    @Test func hoverRectReachesTheTopEdge() {
        let g = NotchGeometry(
            screenFrame: CGRect(x: 0, y: 0, width: 1512, height: 982), safeAreaTop: 32,
            auxiliaryLeftWidth: 664, auxiliaryRightWidth: 664, menuBarHeight: 37
        )
        let rect = IslandLayout.hoverRect(for: .hidden, geometry: g)
        #expect(rect.contains(CGPoint(x: 756, y: 981.5)))
        #expect(!rect.contains(CGPoint(x: 756, y: 900)))
    }
}
