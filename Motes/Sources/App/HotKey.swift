import AppKit
import Carbon.HIToolbox

/// A keyboard shortcut: a key plus modifiers. Pure value, saved in UserDefaults.
struct HotKey: Equatable, Codable, Sendable {
    /// Virtual key code (kVK_…).
    var keyCode: UInt32
    /// `NSEvent.ModifierFlags` raw value, device-independent bits only.
    var modifiers: UInt
    /// The key's character as typed, for display ("M").
    var key: String

    /// ⌃⌥M
    static let `default` = HotKey(keyCode: UInt32(kVK_ANSI_M), modifiers: NSEvent.ModifierFlags([.control, .option]).rawValue, key: "M")

    var flags: NSEvent.ModifierFlags { NSEvent.ModifierFlags(rawValue: modifiers) }

    /// Carbon modifier mask for `RegisterEventHotKey`.
    var carbonModifiers: UInt32 {
        var mask: UInt32 = 0
        if flags.contains(.command) { mask |= UInt32(cmdKey) }
        if flags.contains(.option) { mask |= UInt32(optionKey) }
        if flags.contains(.control) { mask |= UInt32(controlKey) }
        if flags.contains(.shift) { mask |= UInt32(shiftKey) }
        return mask
    }

    /// "⌃⌥⇧⌘M", in the standard macOS order.
    var display: String {
        var text = ""
        if flags.contains(.control) { text += "⌃" }
        if flags.contains(.option) { text += "⌥" }
        if flags.contains(.shift) { text += "⇧" }
        if flags.contains(.command) { text += "⌘" }
        return text + key.uppercased()
    }

    /// A global shortcut needs ⌘, ⌃ or ⌥; Shift alone would steal plain typing.
    var isUsable: Bool {
        !flags.intersection([.command, .control, .option]).isEmpty && !key.isEmpty
    }

    /// Builds a shortcut from a key press, keeping only the modifiers that matter.
    init?(event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
        guard let characters = event.charactersIgnoringModifiers, !characters.isEmpty else { return nil }
        self.init(keyCode: UInt32(event.keyCode), modifiers: modifiers.rawValue, key: characters)
    }

    init(keyCode: UInt32, modifiers: UInt, key: String) {
        self.keyCode = keyCode
        self.modifiers = modifiers
        self.key = key
    }
}

/// Registers one system-wide shortcut through Carbon's hot key API, which needs
/// no Accessibility permission (unlike a global key monitor).
@MainActor
final class GlobalHotKey {
    private var reference: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var action: (() -> Void)?

    static let shared = GlobalHotKey()

    /// Registers `hotKey`, replacing the previous one. `nil` turns it off.
    /// Returns false when the system refuses it (taken by another app).
    @discardableResult
    func register(_ hotKey: HotKey?, action: @escaping () -> Void) -> Bool {
        unregister()
        self.action = action
        guard let hotKey, hotKey.isUsable else { return true }
        installHandlerIfNeeded()
        let id = EventHotKeyID(signature: OSType(0x4D4F5445), id: 1) // 'MOTE'
        let status = RegisterEventHotKey(hotKey.keyCode, hotKey.carbonModifiers, id,
                                         GetApplicationEventTarget(), 0, &reference)
        return status == noErr
    }

    func unregister() {
        if let reference { UnregisterEventHotKey(reference) }
        reference = nil
    }

    fileprivate func fire() {
        action?()
    }

    private func installHandlerIfNeeded() {
        guard handler == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            // Carbon calls back on the main thread.
            MainActor.assumeIsolated { GlobalHotKey.shared.fire() }
            return noErr
        }, 1, &spec, nil, &handler)
    }
}
