import Darwin
import Foundation

/// Small POSIX helpers for the Unix domain socket. Compiled into both targets.
enum UnixSocket {
    /// Builds a `sockaddr_un` for `path`. Fails if the path is too long.
    static func address(_ path: String) -> sockaddr_un? {
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        let capacity = MemoryLayout.size(ofValue: addr.sun_path)
        guard bytes.count < capacity else { return nil }
        withUnsafeMutableBytes(of: &addr.sun_path) { buffer in
            buffer.copyBytes(from: bytes)
            buffer[bytes.count] = 0
        }
        addr.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        return addr
    }

    /// Sends `data` to the socket at `path`, giving up after `timeout`.
    /// Never throws and never blocks longer than the timeout.
    @discardableResult
    static func send(_ data: Data, to path: String, timeout: TimeInterval) -> Bool {
        guard let fd = connectAndWrite(data, to: path, timeout: timeout) else { return false }
        shutdown(fd, SHUT_WR)
        close(fd)
        return true
    }

    /// Sends `data`, then waits up to `replyTimeout` for one newline-terminated
    /// reply. The write side stays open: closing it tells the app the hook gave up. Returns `nil` if the app can't be reached in `timeout`, doesn't
    /// answer in time, or closes without answering.
    static func request(_ data: Data, to path: String, timeout: TimeInterval, replyTimeout: TimeInterval) -> Data? {
        guard let fd = connectAndWrite(data, to: path, timeout: timeout) else { return nil }
        defer { close(fd) }
        let deadline = Date().addingTimeInterval(replyTimeout)
        var reply = Data()
        var chunk = [UInt8](repeating: 0, count: 16 * 1024)
        while reply.count <= BridgeProtocol.maxMessageBytes {
            let count = read(fd, &chunk, chunk.count)
            if count > 0 {
                reply.append(contentsOf: chunk[0..<count])
                if let newline = reply.firstIndex(of: 0x0A) { return Data(reply[..<newline]) }
            } else if count == 0 {
                return reply.isEmpty ? nil : reply
            } else if errno == EAGAIN || errno == EINTR {
                guard wait(fd, for: Int16(POLLIN), until: deadline) else { return nil }
            } else {
                return nil
            }
        }
        return nil
    }

    /// Connects and writes the whole message; returns the open socket.
    private static func connectAndWrite(_ data: Data, to path: String, timeout: TimeInterval) -> Int32? {
        guard var addr = address(path) else { return nil }
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        var ok = false
        defer { if !ok { close(fd) } }

        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)

        let deadline = Date().addingTimeInterval(timeout)
        let connected = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if connected != 0 {
            guard errno == EINPROGRESS, wait(fd, for: Int16(POLLOUT), until: deadline) else { return nil }
            var error: Int32 = 0
            var length = socklen_t(MemoryLayout<Int32>.size)
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &length)
            guard error == 0 else { return nil }
        }

        var offset = 0
        while offset < data.count {
            let written = data.withUnsafeBytes { buffer in
                Darwin.write(fd, buffer.baseAddress! + offset, data.count - offset)
            }
            if written > 0 {
                offset += written
            } else if written < 0, errno == EAGAIN || errno == EINTR {
                guard wait(fd, for: Int16(POLLOUT), until: deadline) else { return nil }
            } else {
                return nil
            }
        }
        ok = true
        return fd
    }

    /// Waits until `fd` is ready for `events` or the deadline passes.
    private static func wait(_ fd: Int32, for events: Int16, until deadline: Date) -> Bool {
        while true {
            let remaining = deadline.timeIntervalSinceNow
            guard remaining > 0 else { return false }
            var pfd = pollfd(fd: fd, events: events, revents: 0)
            let result = poll(&pfd, 1, Int32(remaining * 1000))
            if result > 0 { return pfd.revents & events != 0 }
            if result == 0 || errno != EINTR { return false }
        }
    }
}
