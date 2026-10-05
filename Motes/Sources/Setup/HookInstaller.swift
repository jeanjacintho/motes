import Foundation
import Observation

/// Installs Motes' hooks in an agent's settings file, the safe way:
/// read → dated backup → merge → show the diff → write only once the user confirms.
@MainActor
@Observable
final class HookInstaller {
    enum Action: Equatable { case install, uninstall }

    /// A change ready to be confirmed.
    struct Plan: Equatable {
        let action: Action
        let diff: String
        fileprivate let newContents: Data
    }

    private(set) var status: HookSettings.Status = .notInstalled
    private(set) var lastError: String?
    private(set) var lastBackup: URL?

    let target: HookTarget
    let settingsURL: URL
    let hookPath: String

    init(
        target: HookTarget = .claude,
        settingsURL: URL? = nil,
        hookPath: String = HookBinaryInstaller.installedURL.path
    ) {
        self.target = target
        self.settingsURL = settingsURL ?? target.settingsURL
        self.hookPath = hookPath
        refresh()
    }

    func refresh() {
        do {
            status = HookSettings.status(of: try readSettings(), target: target, hookPath: hookPath)
            lastError = nil
        } catch {
            lastError = message(for: error)
        }
    }

    /// Builds the change without writing anything.
    func plan(_ action: Action) -> Plan? {
        do {
            let current = try readSettings()
            let updated = action == .install
                ? HookSettings.installing(into: current, target: target, hookPath: hookPath)
                : HookSettings.removing(from: current)
            let before = try Self.serialize(current)
            let after = try Self.serialize(updated)
            let diff = LineDiff.render(LineDiff.diff(Self.lines(before), Self.lines(after)))
            lastError = nil
            return Plan(action: action, diff: diff, newContents: after)
        } catch {
            lastError = message(for: error)
            return nil
        }
    }

    /// Backs up the current file, then writes the planned contents.
    func apply(_ plan: Plan) {
        do {
            let manager = FileManager.default
            try manager.createDirectory(at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            if manager.fileExists(atPath: settingsURL.path) {
                let backup = Self.backupURL(for: settingsURL, date: .now)
                try manager.copyItem(at: settingsURL, to: backup)
                lastBackup = backup
            }
            try plan.newContents.write(to: settingsURL, options: .atomic)
            lastError = nil
        } catch {
            lastError = message(for: error)
        }
        refresh()
    }

    // MARK: - Files

    enum ReadError: Error { case notAnObject }

    private func readSettings() throws -> [String: Any] {
        guard let data = try? Data(contentsOf: settingsURL), !data.isEmpty else { return [:] }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ReadError.notAnObject
        }
        return object
    }

    static func serialize(_ settings: [String: Any]) throws -> Data {
        var data = try JSONSerialization.data(
            withJSONObject: settings, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        )
        data.append(0x0A)
        return data
    }

    /// `settings.json.bak-20261004-1932`, with a counter if that name is taken.
    static func backupURL(for url: URL, date: Date, fileManager: FileManager = .default) -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmm"
        let base = url.path + ".bak-" + formatter.string(from: date)
        var candidate = base
        var counter = 2
        while fileManager.fileExists(atPath: candidate) {
            candidate = "\(base)-\(counter)"
            counter += 1
        }
        return URL(fileURLWithPath: candidate)
    }

    private static func lines(_ data: Data) -> [String] {
        String(decoding: data, as: UTF8.self).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    private func message(for error: Error) -> String {
        let nsError = error as NSError
        // 3840: JSONSerialization couldn't parse the file.
        if error is ReadError || (nsError.domain == NSCocoaErrorDomain && nsError.code == 3840) {
            return "\(settingsURL.path) isn't valid JSON. Fix it first; Motes won't touch it."
        }
        return error.localizedDescription
    }
}
