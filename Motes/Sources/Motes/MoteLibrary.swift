import Foundation
import Observation
import os

/// The motes the user created, saved to `~/Library/Application Support/Motes/motes.json`.
@MainActor
@Observable
final class MoteLibrary {
    private(set) var motes: [Mote] = []
    private(set) var lastError: String?
    let fileURL: URL
    @ObservationIgnored private let log = Logger(subsystem: "app.motes", category: "library")

    init(fileURL: URL = BridgeProtocol.supportDirectory.appendingPathComponent("motes.json")) {
        self.fileURL = fileURL
        load()
    }

    func mote(id: String) -> Mote? {
        motes.first { $0.id == id }
    }

    func add(_ mote: Mote) {
        motes.append(mote)
        save()
    }

    func remove(id: String) {
        motes.removeAll { $0.id == id }
        save()
    }

    // MARK: - File

    private struct File: Codable {
        var version = 1
        var motes: [Mote]
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        do {
            motes = try Self.decoder.decode(File.self, from: data).motes
        } catch {
            // Keep the broken file untouched; start empty rather than overwrite it.
            lastError = "Couldn't read \(fileURL.path): \(error.localizedDescription)"
            log.error("\(self.lastError ?? "", privacy: .public)")
        }
    }

    private func save() {
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try Self.encoder.encode(File(motes: motes)).write(to: fileURL, options: .atomic)
            lastError = nil
        } catch {
            lastError = "Couldn't save motes: \(error.localizedDescription)"
            log.error("\(self.lastError ?? "", privacy: .public)")
        }
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
