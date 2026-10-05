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
        guard var addr = address(path) else { return false }
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }

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
            guard errno == EINPROGRESS, wait(fd, for: Int16(POLLOUT), until: deadline) else { return false }
            var error: Int32 = 0
            var length = socklen_t(MemoryLayout<Int32>.size)
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &length)
            guard error == 0 else { return false }
        }

        var offset = 0
        while offset < data.count {
            let written = data.withUnsafeBytes { buffer in
                Darwin.write(fd, buffer.baseAddress! + offset, data.count - offset)
            }
            if written > 0 {
                offset += written
            } else if written < 0, errno == EAGAIN || errno == EINTR {
                guard wait(fd, for: Int16(POLLOUT), until: deadline) else { return false }
            } else {
                return false
            }
        }
        shutdown(fd, SHUT_WR)
        return true
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
