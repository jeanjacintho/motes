import SwiftUI

/// Settings window. More sections (behavior, hotkey, startup) arrive in M5.
struct SettingsView: View {
    let library: MoteLibrary
    let preferences: Preferences
    let hookInstallers: [HookInstaller]
    let onNewMote: () -> Void

    var body: some View {
        Form {
            GeneralSection(preferences: preferences)
            MotesSection(library: library, onNewMote: onNewMote)
            ForEach(hookInstallers, id: \.target.id) { installer in
                HooksSection(installer: installer)
            }

            Section {
                LabeledContent("Version", value: AppInfo.displayVersion(bundle: .main))
            }
        }
        .formStyle(.grouped)
        .frame(width: 480)
        .fixedSize(horizontal: false, vertical: true)
    }
}
