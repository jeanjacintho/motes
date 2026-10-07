import Foundation
import Security

/// Where the GitHub token comes from: a token the user pasted (Keychain), or
/// the GitHub CLI's login, asked each time and never stored by Motes.
enum GitHubToken {
    enum Source: Equatable, Sendable { case keychain, ghCLI }

    private static let service = "app.motes.github"
    private static let account = "token"
    /// Apps opened from Finder have no shell PATH.
    static let ghPaths = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]

    /// The pasted token first, then the GitHub CLI's.
    static func load() async -> (token: String, source: Source)? {
        if let token = keychainToken() { return (token, .keychain) }
        if let token = await ghToken() { return (token, .ghCLI) }
        return nil
    }

    // MARK: - Keychain

    static func keychainToken() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, let token = String(data: data, encoding: .utf8), !token.isEmpty
        else { return nil }
        return token
    }

    static func save(_ token: String) -> Bool {
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return false }
        removeKeychainToken()
        var item = baseQuery
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func removeKeychainToken() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    // MARK: - GitHub CLI

    /// `gh auth token --hostname github.com`, or `nil` without gh or a login.
    static func ghToken() async -> String? {
        guard let gh = ghPaths.first(where: FileManager.default.isExecutableFile(atPath:)) else { return nil }
        return await Task.detached {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: gh)
            process.arguments = ["auth", "token", "--hostname", "github.com"]
            let output = Pipe()
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            do { try process.run() } catch { return nil }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            let token = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            return token.isEmpty ? nil : token
        }.value
    }
}
