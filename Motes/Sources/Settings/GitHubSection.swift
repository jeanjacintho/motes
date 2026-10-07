import SwiftUI

/// Turns the GitHub pull request and CI chips on, and says which login is used.
struct GitHubSection: View {
    let preferences: Preferences
    let monitor: GitHubMonitor
    @State private var token = ""
    @State private var hasSavedToken = GitHubToken.keychainToken() != nil
    @State private var saveFailed = false

    var body: some View {
        Section {
            Toggle("Show pull requests and checks", isOn: Binding(
                get: { preferences.gitHubEnabled },
                set: { enabled in
                    preferences.setGitHubEnabled(enabled)
                    monitor.setEnabled(enabled)
                }
            ))

            if preferences.gitHubEnabled {
                LabeledContent("Account") {
                    HStack(spacing: 6) {
                        Circle().fill(statusColor).frame(width: 8, height: 8)
                        Text(statusText)
                    }
                }
                if case .failed(let message) = monitor.connection {
                    Text(message).foregroundStyle(.red).font(.callout)
                }

                if hasSavedToken {
                    Button("Remove Saved Token") {
                        GitHubToken.removeKeychainToken()
                        hasSavedToken = false
                        monitor.tokenChanged()
                    }
                } else {
                    HStack {
                        SecureField("Token (optional with gh)", text: $token)
                        Button("Save") {
                            saveFailed = !GitHubToken.save(token)
                            hasSavedToken = !saveFailed
                            token = ""
                            monitor.tokenChanged()
                        }
                        .disabled(token.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    if saveFailed {
                        Text("Couldn't save the token in the Keychain.").foregroundStyle(.red).font(.callout)
                    }
                }
            }
        } header: {
            Text("GitHub")
        } footer: {
            Text("For each session's branch, Motes asks api.github.com for its open pull request, checks and reviews. It reads only. It uses the GitHub CLI's login (gh auth login) or a token you paste here, kept in the Keychain; read access to pull requests, checks and commit statuses is enough.")
                .foregroundStyle(.secondary)
        }
    }

    private var statusText: String {
        switch monitor.connection {
        case .off, .connecting: "Connecting…"
        case .connected(.keychain): "Using the saved token"
        case .connected(.ghCLI): "Using the GitHub CLI's login"
        case .noToken: "No login: run gh auth login or paste a token"
        case .failed: "Not connected"
        }
    }

    private var statusColor: Color {
        switch monitor.connection {
        case .connected: .green
        case .off, .connecting: .secondary
        case .noToken, .failed: .orange
        }
    }
}
