import SwiftUI

@main
struct MotesApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra("Motes", systemImage: "sparkles") {
            MenuBarMenu(island: appDelegate.island, sessions: appDelegate.sessions) {
                appDelegate.newMoteWindow.show()
            }
        }

        Settings {
            SettingsView(library: appDelegate.library, hookInstaller: appDelegate.hookInstaller) {
                appDelegate.newMoteWindow.show()
            }
        }
    }
}
