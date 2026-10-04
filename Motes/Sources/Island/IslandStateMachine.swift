import Foundation

/// Open / close logic of the island. Pure: it never starts timers itself,
/// it returns effects that the controller runs, so every rule is testable.
struct IslandStateMachine {
    enum Event: Equatable {
        case pointerEntered
        case pointerExited
        /// Click on the island.
        case clicked
        /// Click anywhere outside the island.
        case clickedOutside
        /// Open from the menu bar or a shortcut, wherever the pointer is.
        case openRequested
        case sessionsChanged(hasSessions: Bool)
        case timerFired(Timer)
    }

    enum Timer: Equatable, Hashable {
        /// Pointer has rested on the island long enough to open it.
        case hoverOpen
        /// Return to the resting mode.
        case collapse
    }

    enum Effect: Equatable {
        case schedule(Timer, after: TimeInterval)
        case cancel(Timer)
    }

    struct Delays: Equatable {
        /// Hover on a hidden or compact island before it opens.
        var hoverOpen: TimeInterval = 0.45
        /// Pointer away from a compact island with nothing running before it hides.
        var compactLeave: TimeInterval = 0.5
        /// Pointer away from an open island before it closes.
        var expandedLeave: TimeInterval = 1.0
        /// Open from the menu without the pointer on it: how long it stays.
        var openedFromMenu: TimeInterval = 5
    }

    private(set) var mode: IslandMode = .hidden
    private(set) var isHovering = false
    private(set) var hasSessions = false
    var delays = Delays()

    /// Mode the island falls back to when nobody is looking at it.
    var restingMode: IslandMode { hasSessions ? .compact : .hidden }

    mutating func handle(_ event: Event) -> [Effect] {
        switch event {
        case .pointerEntered:
            isHovering = true
            switch mode {
            case .hidden:
                mode = .compact
                return [.cancel(.collapse), .schedule(.hoverOpen, after: delays.hoverOpen)]
            case .compact:
                return [.cancel(.collapse), .schedule(.hoverOpen, after: delays.hoverOpen)]
            case .expanded:
                return [.cancel(.collapse)]
            }

        case .pointerExited:
            isHovering = false
            switch mode {
            case .hidden:
                return [.cancel(.hoverOpen)]
            case .compact:
                if hasSessions { return [.cancel(.hoverOpen)] }
                return [.cancel(.hoverOpen), .schedule(.collapse, after: delays.compactLeave)]
            case .expanded:
                return [.cancel(.hoverOpen), .schedule(.collapse, after: delays.expandedLeave)]
            }

        case .clicked:
            guard mode != .expanded else { return [] }
            mode = .expanded
            return [.cancel(.hoverOpen), .cancel(.collapse)]

        case .clickedOutside:
            guard mode == .expanded else { return [] }
            mode = restingMode
            return [.cancel(.hoverOpen), .cancel(.collapse)]

        case .openRequested:
            mode = .expanded
            if isHovering { return [.cancel(.hoverOpen), .cancel(.collapse)] }
            return [.cancel(.hoverOpen), .schedule(.collapse, after: delays.openedFromMenu)]

        case .sessionsChanged(let value):
            hasSessions = value
            if mode == .hidden && value { mode = .compact }
            if mode == .compact && !value && !isHovering { mode = .hidden }
            return []

        case .timerFired(.hoverOpen):
            guard isHovering, mode != .expanded else { return [] }
            mode = .expanded
            return [.cancel(.collapse)]

        case .timerFired(.collapse):
            guard !isHovering else { return [] }
            mode = restingMode
            return []
        }
    }
}
