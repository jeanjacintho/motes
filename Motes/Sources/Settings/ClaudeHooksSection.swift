import SwiftUI

/// Install or remove Motes' Claude Code hooks, always showing the diff first.
struct ClaudeHooksSection: View {
    let installer: ClaudeHookInstaller
    @State private var pendingPlan: ClaudeHookInstaller.Plan?

    var body: some View {
        Section {
            LabeledContent("Hooks") {
                HStack(spacing: 6) {
                    Circle().fill(statusColor).frame(width: 8, height: 8)
                    Text(statusText)
                }
            }

            HStack {
                if installer.status != .installed {
                    Button(installer.status == .outdated ? "Update Hooks…" : "Install Hooks…") {
                        pendingPlan = installer.plan(.install)
                    }
                }
                if installer.status != .notInstalled {
                    Button("Remove Hooks…") {
                        pendingPlan = installer.plan(.uninstall)
                    }
                }
            }

            if let error = installer.lastError {
                Text(error).foregroundStyle(.red).font(.callout)
            }
            if let backup = installer.lastBackup {
                Text("Backup saved to \(backup.path)").foregroundStyle(.secondary).font(.caption)
                    .textSelection(.enabled)
            }
        } header: {
            Text("Claude Code")
        } footer: {
            Text("Motes adds its hooks to \(installer.settingsURL.path) next to yours, after a dated backup. If Motes isn't running, Claude Code carries on as usual.")
                .foregroundStyle(.secondary)
        }
        .onAppear { installer.refresh() }
        .sheet(item: $pendingPlan) { plan in
            HookDiffSheet(plan: plan, path: installer.settingsURL.path) {
                installer.apply(plan)
                pendingPlan = nil
            } onCancel: {
                pendingPlan = nil
            }
        }
    }

    private var statusText: String {
        switch installer.status {
        case .installed: "Installed"
        case .outdated: "Needs an update"
        case .notInstalled: "Not installed"
        }
    }

    private var statusColor: Color {
        switch installer.status {
        case .installed: .green
        case .outdated: .orange
        case .notInstalled: .secondary
        }
    }
}

extension ClaudeHookInstaller.Plan: Identifiable {
    var id: String { diff }
}

/// Shows exactly what will change in the file before anything is written.
private struct HookDiffSheet: View {
    let plan: ClaudeHookInstaller.Plan
    let path: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(plan.action == .install ? "Install Motes hooks" : "Remove Motes hooks")
                .font(.headline)
            Text("These changes will be written to \(path). The current file is backed up first.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(plan.diff.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { _, line in
                        Text(String(line))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(color(for: line))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(background(for: line))
                    }
                }
                .textSelection(.enabled)
                .padding(8)
            }
            .frame(height: 320)
            .background(Color(nsColor: .textBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 6))

            HStack {
                Spacer()
                Button("Cancel", role: .cancel, action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button("Back Up and Write", action: onConfirm)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 560)
    }

    private func color(for line: Substring) -> Color {
        line.hasPrefix("+ ") ? .green : line.hasPrefix("- ") ? .red : .primary
    }

    private func background(for line: Substring) -> Color {
        line.hasPrefix("+ ") ? .green.opacity(0.1) : line.hasPrefix("- ") ? .red.opacity(0.1) : .clear
    }
}
