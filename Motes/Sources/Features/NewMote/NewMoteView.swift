import AppKit
import SwiftUI

/// Window to create a mote: name, folder, form, color and CLI, with a live preview.
/// Creating it opens a Terminal in the folder, tied to the mote.
struct NewMoteView: View {
    let library: MoteLibrary
    let onClose: () -> Void

    @State private var name = ""
    @State private var folder: URL?
    @State private var form: MoteForm = .calm
    @State private var color: MotePalette = .coral
    @State private var cli: MoteCLI = .claude
    @State private var error: String?

    var body: some View {
        HStack(alignment: .top, spacing: 24) {
            preview
            VStack(alignment: .leading, spacing: 16) {
                field("Name") {
                    TextField("My project", text: $name)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: name) { _, value in
                            if value.count > Mote.maxNameLength { name = String(value.prefix(Mote.maxNameLength)) }
                        }
                }
                field("Folder") {
                    HStack {
                        Text(folder?.path(percentEncoded: false) ?? "No folder chosen")
                            .foregroundStyle(folder == nil ? .secondary : .primary)
                            .lineLimit(1)
                            .truncationMode(.head)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button("Choose…", action: chooseFolder)
                    }
                }
                field("Form") { formPicker }
                field("Color") { colorPicker }
                field("CLI") {
                    Picker("CLI", selection: $cli) {
                        ForEach(MoteCLI.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    if !cli.hasHookSupport {
                        Text("\(cli.title) opens in Terminal, but its live status isn't supported yet.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if let error {
                    Text(error).foregroundStyle(.red).font(.callout)
                }

                HStack {
                    Spacer()
                    Button("Cancel", action: onClose)
                        .keyboardShortcut(.cancelAction)
                    Button("Create and Open Terminal", action: create)
                        .keyboardShortcut(.defaultAction)
                        .disabled(!canCreate)
                }
            }
            .frame(width: 380)
        }
        .padding(24)
    }

    // MARK: - Parts

    private var previewPersonality: MotePersonality {
        MotePersonality(id: "preview", name: name, form: form, color: color)
    }

    private var preview: some View {
        VStack(spacing: 4) {
            MoteView(personality: previewPersonality, state: .idle, screenAnchor: nil)
                .id("\(form)-\(color)")
                .frame(width: 160, height: 160)
            Text(name.isEmpty ? "Unnamed" : name)
                .font(.headline)
                .foregroundStyle(.white)
            Text(form.title)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.6))
        }
        .frame(width: 200, height: 260)
        .background(.black, in: RoundedRectangle(cornerRadius: 16))
    }

    private var formPicker: some View {
        HStack(spacing: 6) {
            ForEach(MoteForm.allCases, id: \.self) { option in
                Button { form = option } label: {
                    VStack(spacing: 0) {
                        MoteView(
                            personality: MotePersonality(id: option.rawValue, name: "", form: option, color: color),
                            state: .idle, screenAnchor: nil
                        )
                        .id("\(option)-\(color)")
                        .frame(width: 60, height: 60)
                        Text(option.title).font(.caption2).foregroundStyle(.white.opacity(0.8))
                    }
                    .padding(.bottom, 4)
                    .background(.black, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(option == form ? Color.accentColor : .clear, lineWidth: 2))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var colorPicker: some View {
        HStack(spacing: 8) {
            ForEach(MotePalette.allCases, id: \.self) { option in
                Button { color = option } label: {
                    Circle()
                        .fill(option.color.color)
                        .frame(width: 26, height: 26)
                        .overlay(Circle().strokeBorder(.primary.opacity(option == color ? 0.9 : 0), lineWidth: 2).padding(-4))
                }
                .buttonStyle(.plain)
                .help(option.title)
            }
        }
        .padding(.horizontal, 4)
    }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.weight(.semibold))
            content()
        }
    }

    // MARK: - Actions

    private var canCreate: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && folder != nil
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        folder = url
        if name.isEmpty { name = String(url.lastPathComponent.prefix(Mote.maxNameLength)) }
    }

    private func create() {
        guard let folder else { return }
        let mote = Mote(
            name: name.trimmingCharacters(in: .whitespaces),
            folder: folder.path(percentEncoded: false),
            form: form, color: color, cli: cli
        )
        do {
            try MoteLauncher.open(mote)
            library.add(mote)
            onClose()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Hosts `NewMoteView` in its own window, so the menu, the island and the
/// settings can all open it. One window at a time.
@MainActor
final class NewMoteWindowController {
    private var window: NSWindow?
    private let library: MoteLibrary

    init(library: MoteLibrary) {
        self.library = library
    }

    func show() {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let view = NewMoteView(library: library) { [weak self] in self?.close() }
        let window = NSWindow(contentViewController: NSHostingController(rootView: view))
        window.title = "New Mote"
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.center()
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.window = nil }
        }
        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func close() {
        window?.close()
        window = nil
    }
}
