import SwiftUI

@main
struct MotesApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra("Motes", systemImage: "sparkles") {
            MenuBarMenu(island: appDelegate.island)
        }

        Settings {
            SettingsView()
        }
    }
}
