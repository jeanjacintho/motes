import AppKit
import ApplicationServices
import os

/// Sends a message to a Code session of the Claude desktop app: opens that
/// conversation, pastes the line into its message box and presses Return.
/// The app has no way to take a message from outside, so this types like the
/// user would, which needs the Accessibility permission. It never types unless
/// the right conversation was found, Claude is in front and the focus is in a
/// text box; otherwise the message is left on the clipboard.
@MainActor
enum DesktopTyper {
    enum Result: Equatable {
        case sent
        /// The conversation isn't in the app's session files.
        case notFound
        case needsAccessibility
        /// Claude didn't come forward with its message box focused: the line is on the clipboard.
        case copied
    }

    private static let log = Logger(subsystem: "app.motes", category: "terminal")
    private static let textRoles: Set<String> = ["AXTextArea", "AXTextField", "AXComboBox"]

    static func send(_ line: String, cliSessionID: String) async -> Result {
        // Shows the system prompt the first time.
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        guard AXIsProcessTrustedWithOptions(options) else {
            log.notice("Not typing: Motes isn't trusted for Accessibility")
            return .needsAccessibility
        }

        let url = await Task.detached {
            ClaudeDesktopSessions.localSessionID(forCLISession: cliSessionID)
                .flatMap(ClaudeDesktopSessions.continueURL(localSessionID:))
        }.value
        // Without the exact conversation, typing would land in whichever one is open.
        guard let url else {
            log.notice("Not typing: no Claude desktop conversation for this session")
            return .notFound
        }
        NSWorkspace.shared.open(url)

        guard let app = await frontmostClaude(within: .seconds(5)) else {
            log.notice("Not typing: Claude didn't come to the front (front: \(NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "-", privacy: .public))")
            return copy(line)
        }
        // Let the app switch to the conversation and focus its message box.
        try? await Task.sleep(for: .milliseconds(600))
        guard await textBoxFocused(in: app, within: .seconds(2)) else { return copy(line) }

        let saved = PasteboardSnapshot.take()
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(line, forType: .string)
        let ours = pasteboard.changeCount

        press(9, flags: .maskCommand, pid: app.processIdentifier) // V
        try? await Task.sleep(for: .milliseconds(150))
        press(36, flags: [], pid: app.processIdentifier) // Return
        try? await Task.sleep(for: .milliseconds(400))
        // Put the user's clipboard back, unless they copied something meanwhile.
        if pasteboard.changeCount == ours { saved.restore() }
        log.notice("Sent a message to a Claude desktop session")
        return .sent
    }

    private static func copy(_ line: String) -> Result {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(line, forType: .string)
        log.notice("Claude wasn't ready; left the message on the clipboard")
        return .copied
    }

    private static func frontmostClaude(within timeout: Duration) async -> NSRunningApplication? {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier == ClaudeDesktopSessions.bundleID {
                return app
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return nil
    }

    /// Polls: the tree of an Electron app fills in a moment after it's turned on.
    private static func textBoxFocused(in app: NSRunningApplication, within timeout: Duration) async -> Bool {
        let deadline = ContinuousClock.now + timeout
        var last = "-"
        while ContinuousClock.now < deadline {
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
                log.notice("Not typing: Claude is no longer in front")
                return false
            }
            let focus = focusedElement(of: app.processIdentifier)
            if focus.isTextBox { return true }
            last = focus.description
            try? await Task.sleep(for: .milliseconds(150))
        }
        log.notice("Not typing: the focus isn't in a text box (\(last, privacy: .public))")
        return false
    }

    private static func focusedElement(of pid: pid_t) -> (isTextBox: Bool, description: String) {
        let app = AXUIElementCreateApplication(pid)
        // Electron apps expose their accessibility tree only when asked.
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        var focused: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused)
        guard error == .success, let value = focused, CFGetTypeID(value) == AXUIElementGetTypeID() else {
            return (false, "no focused element, AX error \(error.rawValue)")
        }
        let element = value as! AXUIElement
        let role = string(element, kAXRoleAttribute) ?? "-"
        let subrole = string(element, kAXSubroleAttribute) ?? "-"
        var editable: CFTypeRef?
        AXUIElementCopyAttributeValue(element, "AXEditableAncestor" as CFString, &editable)
        // A contenteditable box (the chat's composer) has itself as editable ancestor.
        let isEditable = editable != nil
        return (textRoles.contains(role) || isEditable, "role \(role), subrole \(subrole), editable \(isEditable)")
    }

    private static func string(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        return value as? String
    }

    /// Posts a key press to that app only, never to whatever else is in front.
    private static func press(_ key: CGKeyCode, flags: CGEventFlags, pid: pid_t) {
        let source = CGEventSource(stateID: .hidSystemState)
        for down in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down) else { continue }
            event.flags = flags
            event.postToPid(pid)
        }
    }
}

/// The clipboard's contents, to put them back after pasting.
@MainActor
struct PasteboardSnapshot {
    private let items: [[NSPasteboard.PasteboardType: Data]]

    static func take() -> PasteboardSnapshot {
        let items = (NSPasteboard.general.pasteboardItems ?? []).map { item in
            item.types.reduce(into: [NSPasteboard.PasteboardType: Data]()) { result, type in
                if let data = item.data(forType: type) { result[type] = data }
            }
        }
        return PasteboardSnapshot(items: items)
    }

    func restore() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        guard !items.isEmpty else { return }
        pasteboard.writeObjects(items.map { types in
            let item = NSPasteboardItem()
            for (type, data) in types { item.setData(data, forType: type) }
            return item
        })
    }
}
