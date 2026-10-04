import SwiftUI

/// Items of the menu bar extra. The notch island arrives in M1.
struct MenuBarMenu: View {
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Text(AppInfo.displayVersion(bundle: .main))

        Divider()

        Button("Settings…") {
            // LSUIElement apps don't come to the front on their own.
            NSApp.activate()
            openSettings()
        }
        .keyboardShortcut(",")

        Divider()

        Button("Quit Motes") {
            NSApp.terminate(nil)
        }
        .keyboardShortcut("q")
    }
}
