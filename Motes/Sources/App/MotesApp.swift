import SwiftUI

@main
struct MotesApp: App {
    var body: some Scene {
        MenuBarExtra("Motes", systemImage: "sparkles") {
            MenuBarMenu()
        }

        Settings {
            SettingsView()
        }
    }
}
