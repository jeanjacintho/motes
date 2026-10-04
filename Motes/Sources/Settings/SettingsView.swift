import SwiftUI

/// Settings window. Sections (hooks, behavior, hotkey, startup) arrive in M5.
struct SettingsView: View {
    var body: some View {
        Form {
            Section {
                LabeledContent("Version", value: AppInfo.displayVersion(bundle: .main))
            }
        }
        .formStyle(.grouped)
        .frame(width: 420)
        .fixedSize(horizontal: false, vertical: true)
    }
}
