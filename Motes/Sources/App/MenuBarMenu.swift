import SwiftUI

/// Items of the menu bar extra.
struct MenuBarMenu: View {
    let island: IslandController
    let sessions: SessionController
    let onNewMote: () -> Void
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Text(AppInfo.displayVersion(bundle: .main))

        Divider()

        Button("New Mote…", action: onNewMote)
            .keyboardShortcut("n")

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
                sessions.debugAddFakeSession()
            }
            Button("Clear Fake Sessions") {
                sessions.debugClearFakeSessions()
            }
            Button("Cycle Fake Plan Usage") {
                sessions.debugCycleFakeUsage()
            }
            Divider()
            Picker("Mote State", selection: Binding(
                get: { island.debugMoteState },
                set: { island.debugMoteState = $0 }
            )) {
                Text("Follow Sessions").tag(MoteState?.none)
                Divider()
                ForEach(MoteState.allCases, id: \.self) { state in
                    Text(state.rawValue.capitalized).tag(MoteState?.some(state))
                }
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
