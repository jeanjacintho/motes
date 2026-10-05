import Testing
@testable import Motes

struct IslandStateMachineTests {
    typealias M = IslandStateMachine

    @Test func startsHidden() {
        #expect(M().mode == .hidden)
    }

    @Test func hoverPeeksThenOpens() {
        var m = M()
        let effects = m.handle(.pointerEntered)
        #expect(m.mode == .compact)
        #expect(effects.contains(.schedule(.hoverOpen, after: m.delays.hoverOpen)))
        _ = m.handle(.timerFired(.hoverOpen))
        #expect(m.mode == .expanded)
    }

    @Test func leavingBeforeHoverOpenHidesAgain() {
        var m = M()
        _ = m.handle(.pointerEntered)
        let effects = m.handle(.pointerExited)
        #expect(effects.contains(.cancel(.hoverOpen)))
        #expect(effects.contains(.schedule(.collapse, after: m.delays.compactLeave)))
        _ = m.handle(.timerFired(.collapse))
        #expect(m.mode == .hidden)
    }

    @Test func staleHoverOpenTimerIsIgnored() {
        var m = M()
        _ = m.handle(.pointerEntered)
        _ = m.handle(.pointerExited)
        _ = m.handle(.timerFired(.hoverOpen))
        #expect(m.mode == .compact)
    }

    @Test func clickOpensRightAway() {
        var m = M()
        _ = m.handle(.pointerEntered)
        let effects = m.handle(.clicked)
        #expect(m.mode == .expanded)
        #expect(effects.contains(.cancel(.hoverOpen)))
    }

    @Test func leavingOpenIslandClosesAfterDelay() {
        var m = M()
        _ = m.handle(.pointerEntered)
        _ = m.handle(.clicked)
        let effects = m.handle(.pointerExited)
        #expect(effects.contains(.schedule(.collapse, after: m.delays.expandedLeave)))
        #expect(m.mode == .expanded)
        _ = m.handle(.timerFired(.collapse))
        #expect(m.mode == .hidden)
    }

    @Test func comingBackCancelsTheClose() {
        var m = M()
        _ = m.handle(.pointerEntered)
        _ = m.handle(.clicked)
        _ = m.handle(.pointerExited)
        let effects = m.handle(.pointerEntered)
        #expect(effects.contains(.cancel(.collapse)))
        _ = m.handle(.timerFired(.collapse))
        #expect(m.mode == .expanded)
    }

    @Test func clickOutsideClosesToRestingMode() {
        var m = M()
        _ = m.handle(.sessionsChanged(hasSessions: true))
        _ = m.handle(.openRequested)
        _ = m.handle(.clickedOutside)
        #expect(m.mode == .compact)
    }

    @Test func clickOutsideDoesNothingWhenClosed() {
        var m = M()
        _ = m.handle(.sessionsChanged(hasSessions: true))
        #expect(m.handle(.clickedOutside).isEmpty)
        #expect(m.mode == .compact)
    }

    @Test func sessionsKeepTheIslandCompact() {
        var m = M()
        _ = m.handle(.sessionsChanged(hasSessions: true))
        #expect(m.mode == .compact)
        _ = m.handle(.pointerEntered)
        let effects = m.handle(.pointerExited)
        #expect(!effects.contains(.schedule(.collapse, after: m.delays.compactLeave)))
        #expect(m.mode == .compact)
        _ = m.handle(.sessionsChanged(hasSessions: false))
        #expect(m.mode == .hidden)
    }

    @Test func lastSessionEndingWhileHoveredKeepsCompact() {
        var m = M()
        _ = m.handle(.sessionsChanged(hasSessions: true))
        _ = m.handle(.pointerEntered)
        _ = m.handle(.sessionsChanged(hasSessions: false))
        #expect(m.mode == .compact)
    }

    @Test func openFromMenuClosesByItself() {
        var m = M()
        let effects = m.handle(.openRequested)
        #expect(m.mode == .expanded)
        #expect(effects.contains(.schedule(.collapse, after: m.delays.openedFromMenu)))
        _ = m.handle(.timerFired(.collapse))
        #expect(m.mode == .hidden)
    }

    @Test func openFromMenuWhileHoveredStaysOpen() {
        var m = M()
        _ = m.handle(.pointerEntered)
        let effects = m.handle(.openRequested)
        #expect(!effects.contains { if case .schedule = $0 { true } else { false } })
    }

    @Test func collapseIsIgnoredWhileHovered() {
        var m = M()
        _ = m.handle(.openRequested)
        _ = m.handle(.pointerEntered)
        _ = m.handle(.timerFired(.collapse))
        #expect(m.mode == .expanded)
    }

    @Test func alertOpensAndHoldsTheIsland() {
        var m = M()
        _ = m.handle(.holdChanged(isHeld: true))
        #expect(m.mode == .expanded)
        _ = m.handle(.pointerEntered)
        #expect(!m.handle(.pointerExited).contains { if case .schedule = $0 { true } else { false } })
        _ = m.handle(.clickedOutside)
        _ = m.handle(.timerFired(.collapse))
        #expect(m.mode == .expanded)
    }

    @Test func answeredAlertClosesSoon() {
        var m = M()
        _ = m.handle(.holdChanged(isHeld: true))
        let effects = m.handle(.holdChanged(isHeld: false))
        #expect(effects.contains(.schedule(.collapse, after: m.delays.expandedLeave)))
        _ = m.handle(.timerFired(.collapse))
        #expect(m.mode == .hidden)
    }

    @Test func answeredAlertStaysOpenUnderThePointer() {
        var m = M()
        _ = m.handle(.holdChanged(isHeld: true))
        _ = m.handle(.pointerEntered)
        #expect(m.handle(.holdChanged(isHeld: false)).isEmpty)
        #expect(m.mode == .expanded)
    }

    @Test func heldIslandDoesntHideWhenSessionsEnd() {
        var m = M()
        _ = m.handle(.sessionsChanged(hasSessions: true))
        _ = m.handle(.holdChanged(isHeld: true))
        _ = m.handle(.sessionsChanged(hasSessions: false))
        #expect(m.mode == .expanded)
    }
}
