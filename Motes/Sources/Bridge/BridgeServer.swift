import Darwin
import Foundation
import os

/// Unix socket server that receives hook events from `motes-hook`.
/// Only the current user can connect; each connection sends one
/// newline-terminated JSON message, then the server closes it.
final class BridgeServer: @unchecked Sendable {
    private let path: String
    private let onMessage: @Sendable (Data) -> Void
    // Everything below is only touched on `queue`.
    private let queue = DispatchQueue(label: "app.motes.bridge")
    private var listenFD: Int32 = -1
    private var listenSource: DispatchSourceRead?
    private var clients: [Int32: Client] = [:]
    private let log = Logger(subsystem: "app.motes", category: "bridge")

    private final class Client {
        let source: DispatchSourceRead
        var buffer = Data()
        var timeout: DispatchWorkItem?
        init(source: DispatchSourceRead) { self.source = source }
    }

    enum StartError: Error {
        case pathTooLong, socket(Int32), bind(Int32), listen(Int32)
    }

    init(path: String, onMessage: @escaping @Sendable (Data) -> Void) {
        self.path = path
        self.onMessage = onMessage
    }

    deinit { stop() }

    func start() throws {
        try queue.sync { try startOnQueue() }
    }

    func stop() {
        queue.sync {
            for fd in clients.keys { closeClient(fd) }
            listenSource?.cancel()
            listenSource = nil
            if listenFD >= 0 {
                close(listenFD)
                listenFD = -1
                unlink(path)
            }
        }
    }

    // MARK: - Queue

    private func startOnQueue() throws {
        guard listenFD < 0 else { return }
        guard var addr = UnixSocket.address(path) else { throw StartError.pathTooLong }

        let directory = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        chmod(directory, 0o700)
        // A stale socket from a previous run would make bind fail.
        unlink(path)

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw StartError.socket(errno) }
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0 else { let e = errno; close(fd); throw StartError.bind(e) }
        chmod(path, 0o600)
        guard listen(fd, Int32(BridgeProtocol.maxConnections)) == 0 else {
            let e = errno; close(fd); unlink(path); throw StartError.listen(e)
        }
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)

        listenFD = fd
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in self?.acceptClients() }
        source.resume()
        listenSource = source
        log.info("Listening on \(self.path, privacy: .public)")
    }

    private func acceptClients() {
        while true {
            let fd = accept(listenFD, nil, nil)
            guard fd >= 0 else { return }

            var uid: uid_t = 0, gid: gid_t = 0
            guard getpeereid(fd, &uid, &gid) == 0, uid == getuid(),
                  clients.count < BridgeProtocol.maxConnections else {
                close(fd)
                continue
            }
            var on: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
            _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)

            let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
            let client = Client(source: source)
            source.setEventHandler { [weak self] in self?.readClient(fd) }
            let timeout = DispatchWorkItem { [weak self] in self?.closeClient(fd) }
            client.timeout = timeout
            clients[fd] = client
            queue.asyncAfter(deadline: .now() + BridgeProtocol.readTimeout, execute: timeout)
            source.resume()
        }
    }

    private func readClient(_ fd: Int32) {
        guard let client = clients[fd] else { return }
        var chunk = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = read(fd, &chunk, chunk.count)
            if count > 0 {
                client.buffer.append(contentsOf: chunk[0..<count])
                if let newline = client.buffer.firstIndex(of: 0x0A) {
                    deliver(client.buffer[client.buffer.startIndex..<newline])
                    closeClient(fd)
                    return
                }
                if client.buffer.count > BridgeProtocol.maxMessageBytes {
                    log.error("Dropped oversized message")
                    closeClient(fd)
                    return
                }
            } else if count == 0 {
                // Peer finished without a newline: accept what it sent.
                if !client.buffer.isEmpty { deliver(client.buffer) }
                closeClient(fd)
                return
            } else {
                if errno == EAGAIN || errno == EINTR { return }
                closeClient(fd)
                return
            }
        }
    }

    private func deliver(_ data: Data) {
        onMessage(Data(data))
    }

    private func closeClient(_ fd: Int32) {
        guard let client = clients.removeValue(forKey: fd) else { return }
        client.timeout?.cancel()
        client.source.cancel()
        close(fd)
    }
}
