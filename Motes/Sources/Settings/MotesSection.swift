import SwiftUI

/// The user's motes: open their terminal or delete them.
struct MotesSection: View {
    let library: MoteLibrary
    let onNewMote: () -> Void
    @State private var error: String?

    var body: some View {
        Section {
            if library.motes.isEmpty {
                Text("No motes yet.").foregroundStyle(.secondary)
            }
            ForEach(library.motes) { mote in
                HStack(spacing: 10) {
                    Circle().fill(mote.color.color.color).frame(width: 12, height: 12)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(mote.name)
                        Text("\(mote.cli.title) · \(mote.folder)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                    Spacer()
                    Button("Open Terminal") {
                        do { try MoteLauncher.open(mote); error = nil } catch { self.error = error.localizedDescription }
                    }
                    Button(role: .destructive) { library.remove(id: mote.id) } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .help("Delete \(mote.name). Its folder and terminal are left as they are.")
                }
            }
            Button("New Mote…", action: onNewMote)
            if let error = error ?? library.lastError {
                Text(error).foregroundStyle(.red).font(.callout)
            }
        } header: {
            Text("Motes")
        } footer: {
            Text("Sessions started outside Motes use the mote whose folder they run in, or an automatic mote.")
                .foregroundStyle(.secondary)
        }
    }
}
