import Foundation
import Testing
@testable import Motes

/// Real socket round trip: what `motes-hook` sends is what the app receives.
struct BridgeServerTests {
    final class Inbox: @unchecked Sendable {
        private let lock = NSLock()
        private var messages: [Data] = []
        func add(_ data: Data) { lock.withLock { messages.append(data) } }
        var all: [Data] { lock.withLock { messages } }
    }

    func socketPath() -> String {
        // Short path: sun_path is limited to 104 bytes.
        "/tmp/motes-test-\(UUID().uuidString.prefix(8)).sock"
    }

    func waitFor(_ inbox: Inbox, count: Int) async {
        for _ in 0..<100 where inbox.all.count < count {
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    @Test func receivesARelayedMessage() async throws {
        let path = socketPath()
        let inbox = Inbox()
        let server = BridgeServer(path: path) { inbox.add($0) }
        try server.start()
        defer { server.stop() }

        let message = try #require(HookRelay.message(
            payload: Data(#"{"hook_event_name":"Stop","session_id":"s1"}"#.utf8),
            agent: "codex", eventName: nil, environment: [:]
        ))
        #expect(UnixSocket.send(message, to: path, timeout: 1))
        await waitFor(inbox, count: 1)

        let event = try #require(inbox.all.first.flatMap(HookEvent.parse))
        #expect(event.kind == .stop)
        #expect(event.agent == "codex")
    }

    @Test func socketIsPrivate() throws {
        let path = socketPath()
        let server = BridgeServer(path: path) { _ in }
        try server.start()
        defer { server.stop() }
        let attributes = try FileManager.default.attributesOfItem(atPath: path)
        #expect((attributes[.posixPermissions] as? Int) == 0o600)
    }

    @Test func sendFailsFastWhenNobodyListens() {
        let start = Date()
        #expect(!UnixSocket.send(Data("x\n".utf8), to: socketPath(), timeout: BridgeProtocol.hookTimeout))
        #expect(Date().timeIntervalSince(start) < BridgeProtocol.hookTimeout + 0.2)
    }

    @Test func handlesManyClients() async throws {
        let path = socketPath()
        let inbox = Inbox()
        let server = BridgeServer(path: path) { inbox.add($0) }
        try server.start()
        defer { server.stop() }
        for i in 0..<20 {
            UnixSocket.send(Data("{\"n\":\(i)}\n".utf8), to: path, timeout: 1)
        }
        await waitFor(inbox, count: 20)
        #expect(inbox.all.count == 20)
    }
}
