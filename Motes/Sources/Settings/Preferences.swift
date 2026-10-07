import Foundation
import Observation
import os
import ServiceManagement

/// User preferences that aren't tied to a mote: shortcut and launch at login.
@MainActor
@Observable
final class Preferences {
    private enum Key {
        static let hotKey = "hotKey"
        static let hotKeyEnabled = "hotKeyEnabled"
        static let gitHubEnabled = "gitHubEnabled"
    }

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let log = Logger(subsystem: "app.motes", category: "preferences")
    /// Called when the shortcut changes, to register it again.
    @ObservationIgnored var onHotKeyChange: ((HotKey?) -> Void)?

    private(set) var hotKey: HotKey
    private(set) var hotKeyEnabled: Bool
    private(set) var launchAtLogin: Bool
    /// Pull requests and checks from GitHub; off until the user turns it on.
    private(set) var gitHubEnabled: Bool
    private(set) var lastError: String?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        hotKey = defaults.data(forKey: Key.hotKey).flatMap { try? JSONDecoder().decode(HotKey.self, from: $0) } ?? .default
        hotKeyEnabled = defaults.object(forKey: Key.hotKeyEnabled) as? Bool ?? true
        launchAtLogin = SMAppService.mainApp.status == .enabled
        gitHubEnabled = defaults.bool(forKey: Key.gitHubEnabled)
    }

    func setGitHubEnabled(_ value: Bool) {
        gitHubEnabled = value
        defaults.set(value, forKey: Key.gitHubEnabled)
    }

    /// The shortcut to register, or nil when turned off.
    var activeHotKey: HotKey? { hotKeyEnabled ? hotKey : nil }

    func setHotKey(_ value: HotKey) {
        guard value.isUsable else {
            lastError = "Use at least one of ⌘, ⌃ or ⌥ in the shortcut."
            return
        }
        hotKey = value
        lastError = nil
        defaults.set(try? JSONEncoder().encode(value), forKey: Key.hotKey)
        onHotKeyChange?(activeHotKey)
    }

    func setHotKeyEnabled(_ value: Bool) {
        hotKeyEnabled = value
        defaults.set(value, forKey: Key.hotKeyEnabled)
        onHotKeyChange?(activeHotKey)
    }

    /// Registers the current shortcut again, e.g. after recording was cancelled.
    func reapplyHotKey() {
        onHotKeyChange?(activeHotKey)
    }

    func hotKeyRegistrationFailed() {
        lastError = "\(hotKey.display) is already used by another app. Pick another shortcut."
    }

    func setLaunchAtLogin(_ value: Bool) {
        do {
            if value { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            lastError = nil
        } catch {
            lastError = "Couldn't change Launch at Login: \(error.localizedDescription)"
            log.error("\(self.lastError ?? "", privacy: .public)")
        }
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }
}
