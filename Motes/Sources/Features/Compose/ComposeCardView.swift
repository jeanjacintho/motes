import SwiftUI

/// Writes a message to a session: typed into its Terminal tab, then Return,
/// only when the user clicks Send. Dropped files go in as their paths.
struct ComposeCardView: View {
    let model: IslandModel
    let session: AgentSession
    @FocusState private var focused: Bool
    @State private var dropTargeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if let files = model.composing?.files, !files.isEmpty {
                FileChips(files: files) { path in model.composing?.files.removeAll { $0 == path } }
            }
            HStack(spacing: 8) {
                TextField("Message \(model.title(for: session))…", text: text)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    .focused($focused)
                    .onSubmit { model.onSendMessage?() }
                PillButton("Send", primary: true) { model.onSendMessage?() }
                    .disabled(!canSend)
                    .opacity(canSend ? 1 : 0.5)
            }
            status
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(dropTargeted ? Color.white.opacity(0.05) : .clear)
        .dropDestination(for: URL.self) { urls, _ in
            let paths = urls.filter(\.isFileURL).map(\.path)
            if !paths.isEmpty { model.onCompose?(session.id, paths) }
            return !paths.isEmpty
        } isTargeted: { dropTargeted = $0 }
        .onExitCommand { model.onEndCompose?() }
        // The panel becomes key in the same pass: focus once it has.
        .task { focused = true }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button { model.onEndCompose?() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))
                    .frame(width: 20, height: 20)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Back (Esc)")
            Text("Message \(model.title(for: session))")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
            Spacer(minLength: 8)
        }
    }

    private var status: some View {
        let message: String
        var isError = false
        switch model.composing?.status {
        case .sending:
            message = "Sending…"
        case .failed(let reason):
            message = reason
            isError = true
        default:
            switch TerminalMessage.availability(of: session) {
            case .waitingForAnswer: message = "It's waiting for an answer: answer it first, then send."
            case .claudeDesktop: message = "Sent in its Claude chat, as if you typed it. Drop files to add their paths."
            default: message = "Typed into its Terminal tab, then Return. Drop files to add their paths."
            }
        }
        return Text(message)
            .font(.system(size: 11))
            .foregroundStyle(isError ? MotePalette.coral.color.color : Color.white.opacity(0.45))
            .lineLimit(2)
    }

    private var text: Binding<String> {
        Binding {
            model.composing?.text ?? ""
        } set: { value in
            model.composing?.text = value
            if case .failed = model.composing?.status { model.composing?.status = .editing }
        }
    }

    private var canSend: Bool {
        guard let compose = model.composing, compose.status != .sending else { return false }
        return TerminalMessage.line(text: compose.text, files: compose.files) != nil
    }
}

/// Dropped files, removable one by one.
private struct FileChips: View {
    let files: [String]
    let remove: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(files, id: \.self) { path in
                    HStack(spacing: 4) {
                        Image(systemName: "doc")
                        Text((path as NSString).lastPathComponent).lineLimit(1)
                        Button { remove(path) } label: {
                            Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
                        }
                        .buttonStyle(.plain)
                    }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.75))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.white.opacity(0.08), in: Capsule())
                    .help(path)
                }
            }
        }
    }
}
