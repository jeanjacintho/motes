import SwiftUI

/// Items of the menu bar extra.
struct MenuBarMenu: View {
    let island: IslandController
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Text(AppInfo.displayVersion(bundle: .main))

        Divider()

        Button("Open Island") {
            island.open()
        }

        Button("Settings…") {
            // LSUIElement apps don't come to the front on their own.
            NSApp.activate()
            openSettings()
        }
        .keyboardShortcut(",")

        #if DEBUG
        Menu("Debug") {
            Button("Add Fake Session") {
                island.setFakeSessionCount(island.fakeSessionCount + 1)
            }
            Button("Clear Fake Sessions") {
                island.setFakeSessionCount(0)
            }
        }
        #endif

        Divider()

        Button("Quit Motes") {
            NSApp.terminate(nil)
        }
        .keyboardShortcut("q")
    }
}
