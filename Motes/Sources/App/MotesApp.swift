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
            SettingsView(library: appDelegate.library, preferences: appDelegate.preferences,
                         hookInstallers: appDelegate.hookInstallers, gitHub: appDelegate.gitHub) {
                appDelegate.newMoteWindow.show()
            }
        }
    }
}
