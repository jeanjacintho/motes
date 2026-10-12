import AppKit
import SwiftUI

/// Owns the island panel: places it on the right screen, tracks the pointer,
/// feeds the state machine and runs its timers.
@MainActor
final class IslandController {
    private var machine = IslandStateMachine()
    private let model: IslandModel
    private let panel: IslandPanel
    private var timers: [IslandStateMachine.Timer: Task<Void, Never>] = [:]
    private var monitors: [Any] = []
    private var screenObserver: NSObjectProtocol?
    private var pointerInside = false

    init() {
        model = IslandModel(geometry: Self.currentGeometry())
        panel = IslandPanel(contentRect: CGRect(origin: .zero, size: IslandLayout.panelSize))
        let view = IslandView(model: model) { [weak self] in self?.tapped() }
        model.onShowDiff = { [weak self] sessionID, changeID in self?.showDiff(sessionID: sessionID, changeID: changeID) }
        model.onCompose = { [weak self] sessionID, files in self?.compose(sessionID: sessionID, files: files) }
        model.onSendMessage = { [weak self] in self?.sendMessage() }
        model.onEndCompose = { [weak self] in self?.endCompose() }
        panel.contentView = IslandHostingView(rootView: view)
    }

    func start() {
        placePanel()
        panel.orderFrontRegardless()
        installMonitors()
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.screensChanged() }
        }
    }

    func open() {
        send(.openRequested)
    }

    /// The shortcut: opens the island, or closes it when it's open.
    func toggle() {
        send(model.mode == .expanded ? .closeRequested : .openRequested)
    }

    /// Opens the diff card on an edit, or goes back to the list with `nil`.
    func showDiff(sessionID: String, changeID: UUID?) {
        model.shownDiff = changeID.map { (sessionID, $0) }
        updatePointer(NSEvent.mouseLocation)
    }

    /// Jumps to a session's terminal; set by the app.
    var onJump: ((AgentSession) -> Void)? {
        get { model.onJump }
        set { model.onJump = newValue }
    }

    func setMotes(_ motes: [Mote]) {
        model.motes = motes
    }

    /// Opens the window to create a mote; set by the app.
    var onNewMote: (() -> Void)? {
        get { model.onNewMote }
        set { model.onNewMote = newValue }
    }

    /// Opens a mote's terminal; set by the app.
    var onOpenMote: ((Mote) -> Void)? {
        get { model.onOpenMote }
        set { model.onOpenMote = newValue }
    }

    func setSessions(_ sessions: [AgentSession], focused: AgentSession?, alerts: [PendingAlert]) {
        model.sessions = sessions
        model.alerts = alerts
        // The session asking for something is the one in focus.
        model.focused = alerts.first.flatMap { alert in sessions.first { $0.id == alert.sessionID } } ?? focused
        // A message to a session that ended has nowhere to go.
        if model.composing != nil, model.composingSession == nil { endCompose() }
        send(.sessionsChanged(hasSessions: !sessions.isEmpty))
        updateHold()
    }

    /// Alerts and a message being written keep the island open: clicking
    /// outside (to drag a file from Finder) must not close it.
    private func updateHold() {
        send(.holdChanged(isHeld: !model.alerts.isEmpty || model.composing != nil))
    }

    // MARK: - Messages

    /// Opens the message card for a session, or adds files to the open one.
    func compose(sessionID: String, files: [String]) {
        if let current = model.composing, current.sessionID == sessionID {
            model.composing?.files = current.files + files.filter { !current.files.contains($0) }
        } else {
            model.composing = IslandModel.Compose(sessionID: sessionID, files: files)
        }
        model.shownDiff = nil
        panel.acceptsKeyboard = true
        panel.makeKey()
        updateHold()
    }

    func endCompose() {
        model.composing = nil
        panel.acceptsKeyboard = false
        panel.resignKey()
        updateHold()
    }

    /// Clicking the compact island's mote opens the message card for its session.
    private func tapped() {
        if model.mode == .compact, let focused = model.focused,
           TerminalMessage.availability(of: focused) != .unsupported {
            send(.openRequested)
            compose(sessionID: focused.id, files: [])
        } else {
            send(.clicked)
        }
    }

    /// Sends the message to the session, as typed there. Only from the Send button.
    private func sendMessage() {
        guard let compose = model.composing, compose.status != .sending, let session = model.composingSession,
              let line = TerminalMessage.line(text: compose.text, files: compose.files) else { return }
        let availability = TerminalMessage.availability(of: session)
        switch availability {
        case .waitingForAnswer:
            model.composing?.status = .failed("It's waiting for an answer. Answer it first.")
            return
        case .unsupported:
            model.composing?.status = .failed("Motes can't type where this session runs.")
            return
        case .terminal, .claudeDesktop:
            break
        }
        model.composing?.status = .sending
        if case .claudeDesktop = availability {
            // The panel keeps the keyboard even with Claude in front: let it go,
            // or Claude's message box never gets the focus.
            panel.acceptsKeyboard = false
            panel.resignKey()
        }
        Task { [weak self] in
            let failure: String?
            switch availability {
            case .terminal(let tty):
                switch await TerminalTyper.type(line, tty: tty) {
                case .sent: failure = nil
                case .missing: failure = "Its Terminal tab is gone."
                case .failed: failure = "Motes couldn't type in Terminal. Allow it in System Settings → Privacy & Security → Automation."
                }
            case .claudeDesktop(let sessionID):
                switch await DesktopTyper.send(line, cliSessionID: sessionID) {
                case .sent: failure = nil
                case .notFound: failure = "Couldn't find this conversation in the Claude app. Nothing was sent."
                case .needsAccessibility: failure = "Allow Motes in System Settings → Privacy & Security → Accessibility, then Send again."
                case .copied: failure = "Claude wasn't ready, so nothing was typed. The message is copied: press ⌘V and Return there."
                }
            case .waitingForAnswer, .unsupported:
                failure = nil
            }
            guard let self, self.model.composing?.sessionID == compose.sessionID else { return }
            if let failure {
                self.model.composing?.status = .failed(failure)
                // A click on the card takes the keyboard again; until then ⌘V goes to Claude.
                self.panel.acceptsKeyboard = true
            } else {
                self.endCompose()
            }
        }
    }

    func setPullRequests(_ pullRequests: [String: PullRequestStatus]) {
        model.pullRequests = pullRequests
    }

    func setUsage(_ usage: PlanUsage?) {
        model.usage = usage
    }

    /// Where the answers of alert cards go; set by the app.
    func setAlertHandlers(
        permission: @escaping (UUID, ClaudeReply.Permission) -> Void,
        answers: @escaping (UUID, [String: [String]]) -> Void,
        replyInTerminal: @escaping (UUID) -> Void
    ) {
        model.onPermission = permission
        model.onAnswers = answers
        model.onReplyInTerminal = replyInTerminal
    }

    /// Debug helper: force the mote into a state, `nil` to follow the sessions.
    var debugMoteState: MoteState? {
        get { model.debugMoteState }
        set { model.debugMoteState = newValue }
    }

    // MARK: - State machine

    private func send(_ event: IslandStateMachine.Event) {
        let effects = machine.handle(event)
        if model.mode != machine.mode {
            model.mode = machine.mode
            // A closed island forgets the diff it was showing.
            if machine.mode != .expanded { model.shownDiff = nil }
        }
        for effect in effects {
            switch effect {
            case .schedule(let timer, let delay):
                schedule(timer, after: delay)
            case .cancel(let timer):
                timers.removeValue(forKey: timer)?.cancel()
            }
        }
        // The hover zone follows the mode: re-check where the pointer is.
        updatePointer(NSEvent.mouseLocation)
    }

    private func schedule(_ timer: IslandStateMachine.Timer, after delay: TimeInterval) {
        timers[timer]?.cancel()
        timers[timer] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, let self else { return }
            self.timers[timer] = nil
            self.send(.timerFired(timer))
        }
    }

    // MARK: - Pointer

    private func installMonitors() {
        let moves: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged]
        let clicks: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown]

        // Global monitors see events going to other apps (no permission needed for the mouse).
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: moves, handler: { _ in
            MainActor.assumeIsolated { [weak self] in self?.updatePointer(NSEvent.mouseLocation) }
        }) { monitors.append(monitor) }

        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: clicks, handler: { _ in
            MainActor.assumeIsolated { [weak self] in self?.send(.clickedOutside) }
        }) { monitors.append(monitor) }

        // Local monitor sees events while the pointer is over the panel.
        if let monitor = NSEvent.addLocalMonitorForEvents(matching: moves, handler: { event in
            MainActor.assumeIsolated { [weak self] in self?.updatePointer(NSEvent.mouseLocation) }
            return event
        }) { monitors.append(monitor) }
    }

    private func updatePointer(_ location: CGPoint) {
        // Visible motes follow the pointer with their eyes.
        if model.mode != .hidden { PointerTracker.shared.update(location) }
        let hoverRect = IslandLayout.hoverRect(for: model.mode, geometry: model.geometry, isAlert: model.isTall)
        let inside = hoverRect.contains(location)
        // Only the island itself takes clicks; the transparent rest of the panel lets them through.
        if panel.ignoresMouseEvents == inside {
            panel.ignoresMouseEvents = !inside
        }
        guard inside != pointerInside else { return }
        pointerInside = inside
        send(inside ? .pointerEntered : .pointerExited)
    }

    // MARK: - Screens

    private func screensChanged() {
        let geometry = Self.currentGeometry()
        guard geometry != model.geometry else { return }
        model.geometry = geometry
        placePanel()
        updatePointer(NSEvent.mouseLocation)
    }

    private func placePanel() {
        let frame = model.geometry.topCenteredRect(size: IslandLayout.panelSize)
        panel.setFrame(frame, display: true)
    }

    /// The built-in notched screen if there is one, otherwise the main screen.
    private static func currentGeometry() -> NotchGeometry {
        let screens = NSScreen.screens
        let screen = screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main ?? screens.first
        guard let screen else {
            return NotchGeometry(
                screenFrame: CGRect(x: 0, y: 0, width: 1440, height: 900),
                safeAreaTop: 0, auxiliaryLeftWidth: nil, auxiliaryRightWidth: nil, menuBarHeight: 24
            )
        }
        return NotchGeometry(
            screenFrame: screen.frame,
            safeAreaTop: screen.safeAreaInsets.top,
            auxiliaryLeftWidth: screen.auxiliaryTopLeftArea?.width,
            auxiliaryRightWidth: screen.auxiliaryTopRightArea?.width,
            menuBarHeight: screen.frame.maxY - screen.visibleFrame.maxY
        )
    }
}
