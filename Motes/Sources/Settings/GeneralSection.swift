import AppKit
import SwiftUI

/// Launch at login and the shortcut that opens the island.
struct GeneralSection: View {
    let preferences: Preferences
    @State private var recording = false
    @State private var monitor: Any?

    var body: some View {
        Section {
            Toggle("Launch at login", isOn: Binding(
                get: { preferences.launchAtLogin },
                set: { preferences.setLaunchAtLogin($0) }
            ))

            Toggle("Shortcut to open the island", isOn: Binding(
                get: { preferences.hotKeyEnabled },
                set: { preferences.setHotKeyEnabled($0) }
            ))
            if preferences.hotKeyEnabled {
                LabeledContent("Shortcut") {
                    Button(recording ? "Type a shortcut…" : preferences.hotKey.display) {
                        recording ? stopRecording() : startRecording()
                    }
                    .font(.system(.body, design: .rounded).weight(.medium))
                }
            }
            if let error = preferences.lastError {
                Text(error).foregroundStyle(.red).font(.callout)
            }
        } header: {
            Text("General")
        } footer: {
            Text("Click a session in the island to jump to its terminal. The first time, macOS asks to let Motes control Terminal, to pick the right tab.")
                .foregroundStyle(.secondary)
        }
        .onDisappear(perform: stopRecording)
    }

    private func startRecording() {
        recording = true
        // Otherwise the current shortcut would fire instead of being recorded.
        GlobalHotKey.shared.unregister()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == 53 { // Escape cancels.
                stopRecording()
                return nil
            }
            if let hotKey = HotKey(event: event) {
                preferences.setHotKey(hotKey)
                stopRecording()
            }
            return nil
        }
    }

    private func stopRecording() {
        guard recording else { return }
        recording = false
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        preferences.reapplyHotKey()
    }
}
