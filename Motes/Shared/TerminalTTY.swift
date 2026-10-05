import Darwin

/// Finds the terminal device the agent runs in ("/dev/ttys003"), by walking up
/// from the hook process to its ancestors. Hooks get a pipe as stdin, so the
/// controlling terminal of the process tree is the reliable source.
enum TerminalTTY {
    static func current(maxDepth: Int = 8) -> String? {
        var pid = getpid()
        for _ in 0..<maxDepth {
            guard pid > 1, let info = processInfo(pid) else { return nil }
            if let tty = name(of: info.kp_eproc.e_tdev) { return tty }
            pid = info.kp_eproc.e_ppid
        }
        return nil
    }

    /// Only well-formed Terminal devices are trusted ("/dev/ttys" + digits).
    static func isValid(_ tty: String) -> Bool {
        guard tty.hasPrefix("/dev/ttys") else { return false }
        let digits = tty.dropFirst("/dev/ttys".count)
        return !digits.isEmpty && digits.count <= 4 && digits.allSatisfy(\.isASCII) && digits.allSatisfy(\.isNumber)
    }

    private static func name(of device: dev_t) -> String? {
        guard device != -1, device != 0, let raw = devname(device, S_IFCHR) else { return nil }
        let tty = "/dev/" + String(cString: raw)
        return isValid(tty) ? tty : nil
    }

    private static func processInfo(_ pid: pid_t) -> kinfo_proc? {
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        guard sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0) == 0, size > 0 else { return nil }
        return info
    }
}
