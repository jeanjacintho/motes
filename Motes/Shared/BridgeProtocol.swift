import Foundation

/// Contract between `motes-hook` and the app. Compiled into both targets.
enum BridgeProtocol {
    static let version = 1
    /// Largest message accepted on the socket.
    static let maxMessageBytes = 1 << 20
    /// The hook gives up after this long: the agent must never wait on Motes.
    static let hookTimeout: TimeInterval = 0.3
    /// The app drops a connection that hasn't sent a full message after this long.
    static let readTimeout: TimeInterval = 5
    static let maxConnections = 32
    /// How long a waiting hook keeps the agent waiting for an answer from the
    /// notch before giving up and letting the terminal ask as usual. Kept below
    /// the hook timeouts written in the agent's settings.
    static let approvalWait: TimeInterval = 110
    static let questionWait: TimeInterval = 120
    /// Agent used when `motes_agent` is absent or invalid.
    static let defaultAgent = "claude"

    /// Set in terminals opened by Motes; ties every hook fired there to a mote.
    static let moteEnvironmentKey = "MOTES_MOTE_ID"

    enum Key {
        static let version = "v"
        static let agent = "motes_agent"
        static let mote = "motes_mote"
        /// Seconds the hook will wait for a reply; present only on events that can be answered.
        static let wait = "motes_wait"
        /// Inside `motes_terminal`: the terminal device, found by the hook.
        static let tty = "tty"
        static let terminal = "motes_terminal"
        static let eventName = "hook_event_name"
    }

    /// Environment variables the hook copies so the app can find the terminal later.
    static let terminalEnvironmentKeys = [
        "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM_SESSION_ID", "ITERM_SESSION_ID",
        "__CFBundleIdentifier", "TMUX", "TMUX_PANE", "KITTY_WINDOW_ID", "WEZTERM_PANE",
    ]

    /// Mote IDs are lowercase UUIDs: lowercase letters, digits and hyphens, up to 40 characters.
    static func isValidMoteID(_ id: String) -> Bool {
        guard (1...40).contains(id.count) else { return false }
        return id.unicodeScalars.allSatisfy { scalar in
            ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) || scalar == "-"
        }
    }

    /// `~/Library/Application Support/Motes`
    static var supportDirectory: URL {
        URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent("Library/Application Support/Motes", isDirectory: true)
    }

    static var socketURL: URL { supportDirectory.appendingPathComponent("motes.sock") }

    /// Lowercase letters, digits and hyphens, 1 to 24 characters.
    static func isValidAgentName(_ name: String) -> Bool {
        guard (1...24).contains(name.count) else { return false }
        return name.unicodeScalars.allSatisfy { scalar in
            ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) || scalar == "-"
        }
    }
}

/// What the hook adds to the payload before forwarding it.
enum HookRelay {
    /// How long the hook should wait for an answer to this event, or `nil`
    /// when the event can't be answered from the notch.
    static func waitTime(eventName: String?, toolName: String?) -> TimeInterval? {
        switch eventName {
        case "PermissionRequest": BridgeProtocol.approvalWait
        case "PreToolUse" where toolName == "AskUserQuestion": BridgeProtocol.questionWait
        default: nil
        }
    }

    /// Returns the message to send (JSON object + newline), or `nil` when the
    /// payload isn't a JSON object or is too large.
    static func message(
        payload: Data, agent: String?, eventName: String?, environment: [String: String],
        tty: String? = nil, wait: TimeInterval? = nil
    ) -> Data? {
        guard payload.count <= BridgeProtocol.maxMessageBytes,
              var object = (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any]
        else { return nil }

        object[BridgeProtocol.Key.version] = BridgeProtocol.version
        if let agent, BridgeProtocol.isValidAgentName(agent) {
            object[BridgeProtocol.Key.agent] = agent
        }
        if let wait { object[BridgeProtocol.Key.wait] = wait }
        if let mote = environment[BridgeProtocol.moteEnvironmentKey], BridgeProtocol.isValidMoteID(mote) {
            object[BridgeProtocol.Key.mote] = mote
        }
        if object[BridgeProtocol.Key.eventName] == nil, let eventName {
            object[BridgeProtocol.Key.eventName] = eventName
        }
        var terminal = BridgeProtocol.terminalEnvironmentKeys.reduce(into: [String: String]()) { result, key in
            if let value = environment[key], !value.isEmpty { result[key] = value }
        }
        if let tty, TerminalTTY.isValid(tty) { terminal[BridgeProtocol.Key.tty] = tty }
        if !terminal.isEmpty {
            object[BridgeProtocol.Key.terminal] = terminal
        }

        guard var data = try? JSONSerialization.data(withJSONObject: object) else { return nil }
        data.append(0x0A)
        return data.count <= BridgeProtocol.maxMessageBytes ? data : nil
    }
}

extension HookRelay {
    /// Event and tool names of a raw payload, used by the hook to decide whether to wait.
    static func names(in payload: Data) -> (event: String?, tool: String?) {
        let object = (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any]
        return (object?[BridgeProtocol.Key.eventName] as? String, object?["tool_name"] as? String)
    }

    /// What the hook prints for the agent: the app's reply when it is a JSON
    /// object, nothing otherwise (the agent then asks in its terminal).
    static func output(fromReply reply: Data?) -> Data? {
        guard let reply, !reply.isEmpty,
              (try? JSONSerialization.jsonObject(with: reply)) is [String: Any] else { return nil }
        return reply
    }
}
