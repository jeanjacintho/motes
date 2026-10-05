import AppKit

/// Opens a Terminal window in a mote's folder running its CLI. The window's
/// shell carries `MOTES_MOTE_ID`, so every hook fired from it is tied to the mote.
///
/// Uses a `.command` script opened with Terminal: no Automation permission needed.
enum MoteLauncher {
    enum LaunchError: LocalizedError {
        case folderMissing(String)
        case terminalMissing

        var errorDescription: String? {
            switch self {
            case .folderMissing(let path): "The folder \(path) doesn't exist anymore."
            case .terminalMissing: "Terminal.app couldn't be found."
            }
        }
    }

    static var scriptsDirectory: URL {
        BridgeProtocol.supportDirectory.appendingPathComponent("launch", isDirectory: true)
    }

    /// Shell script run by Terminal. Starts an interactive login shell so the
    /// user's PATH (where `claude` lives) is loaded, runs the CLI, then stays in
    /// a shell in that folder when the CLI exits.
    static func script(for mote: Mote) -> String {
        let cli = mote.cli.command
        return """
        #!/bin/sh
        # Opened by Motes for the mote "\(mote.name.replacingOccurrences(of: "\n", with: " "))".
        cd -- \(shellQuoted(mote.folder)) || exit 1
        export \(BridgeProtocol.moteEnvironmentKey)=\(shellQuoted(mote.id))
        printf '\\033]0;%s\\007' \(shellQuoted(mote.name))
        clear
        exec "${SHELL:-/bin/zsh}" -i -l -c \(shellQuoted("\(cli); exec \"$SHELL\" -i -l"))
        """ + "\n"
    }

    /// Single-quotes `text` for POSIX shells.
    static func shellQuoted(_ text: String) -> String {
        "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    @MainActor
    static func open(_ mote: Mote) throws {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: mote.folder, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw LaunchError.folderMissing(mote.folder)
        }
        guard let terminal = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") else {
            throw LaunchError.terminalMissing
        }

        let manager = FileManager.default
        try manager.createDirectory(at: scriptsDirectory, withIntermediateDirectories: true,
                                    attributes: [.posixPermissions: 0o700])
        let url = scriptsDirectory.appendingPathComponent("\(mote.id).command")
        try script(for: mote).write(to: url, atomically: true, encoding: .utf8)
        try manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.open([url], withApplicationAt: terminal, configuration: configuration)
    }
}
