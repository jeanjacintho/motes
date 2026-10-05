import Foundation
import os

/// Copies the bundled `motes-hook` to a stable place, so agent settings keep
/// working wherever the app itself lives.
enum HookBinaryInstaller {
    /// `~/Library/Application Support/Motes/bin/motes-hook`
    static var installedURL: URL {
        BridgeProtocol.supportDirectory.appendingPathComponent("bin/motes-hook")
    }

    /// Copies the hook if it is missing or differs from the bundled one.
    static func installIfNeeded() {
        let log = Logger(subsystem: "app.motes", category: "setup")
        guard let bundled = Bundle.main.url(forAuxiliaryExecutable: "motes-hook") else {
            log.error("motes-hook is missing from the app bundle")
            return
        }
        let destination = installedURL
        let manager = FileManager.default
        if let current = try? Data(contentsOf: destination),
           let fresh = try? Data(contentsOf: bundled), current == fresh {
            return
        }
        do {
            try manager.createDirectory(at: destination.deletingLastPathComponent(),
                                        withIntermediateDirectories: true,
                                        attributes: [.posixPermissions: 0o700])
            // Copy next to it, then swap, so a running hook never sees a half-written file.
            let temporary = destination.appendingPathExtension("new")
            try? manager.removeItem(at: temporary)
            try manager.copyItem(at: bundled, to: temporary)
            try manager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: temporary.path)
            if manager.fileExists(atPath: destination.path) {
                _ = try manager.replaceItemAt(destination, withItemAt: temporary)
            } else {
                try manager.moveItem(at: temporary, to: destination)
            }
            log.info("Installed motes-hook at \(destination.path, privacy: .public)")
        } catch {
            log.error("Could not install motes-hook: \(String(describing: error), privacy: .public)")
        }
    }
}
