import Foundation

// motes-hook: called by coding agents on each hook event.
// Reads the event JSON on stdin, adds the agent name and the terminal context,
// and forwards it to Motes over its Unix socket. It always exits 0 quickly when
// Motes isn't there, so the agent is never blocked.
//
// With --wait, for events that can be answered from the notch (a permission
// request, a question), it waits for the user's answer and prints the agent's
// decision JSON. No answer in time, or "reply in terminal": it prints nothing
// and the agent asks in its terminal as usual. Without --wait it never prints.
//
// With --statusline it is Claude Code's status line: it forwards the plan
// usage, then runs the user's own status line (--then, base64) and exits with
// its status, or prints the plan usage when there is none.
//
// Usage: motes-hook [--agent <name>] [--wait] [<EventName>]
//        motes-hook --statusline [--then <base64 command>]

var agent: String?
var eventName: String?
var canWait = false
var isStatusLine = false
var chained: String?
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
    switch argument {
    case "--agent": agent = arguments.next()
    case "--wait": canWait = true
    case StatusLineRelay.flag: isStatusLine = true
    case StatusLineRelay.chainFlag: chained = arguments.next().flatMap(StatusLineRelay.decode)
    default: if !argument.hasPrefix("-") { eventName = argument }
    }
}

let input = FileHandle.standardInput.readData(ofLength: BridgeProtocol.maxMessageBytes + 1)
let socketPath = BridgeProtocol.socketURL.path

if isStatusLine {
    // The user's status line starts first, so Motes never delays it.
    let child = chained.flatMap { startStatusLine($0, input: input) }
    if let message = HookRelay.message(
        payload: input, agent: agent, eventName: StatusLineRelay.eventName,
        environment: ProcessInfo.processInfo.environment
    ) {
        UnixSocket.send(message, to: socketPath, timeout: BridgeProtocol.hookTimeout)
    }
    if let child {
        child.waitUntilExit()
        exit(child.terminationStatus)
    }
    if chained == nil, let text = StatusLineRelay.text(payload: input) {
        FileHandle.standardOutput.write(Data((text + "\n").utf8))
    }
    exit(0)
}

let names = HookRelay.names(in: input)
let wait = canWait ? HookRelay.waitTime(eventName: names.event ?? eventName, toolName: names.tool) : nil

guard let message = HookRelay.message(
    payload: input, agent: agent, eventName: eventName,
    environment: ProcessInfo.processInfo.environment, tty: TerminalTTY.current(), wait: wait
) else { exit(0) }

if let wait {
    let reply = UnixSocket.request(message, to: socketPath, timeout: BridgeProtocol.hookTimeout, replyTimeout: wait)
    if let output = HookRelay.output(fromReply: reply) {
        FileHandle.standardOutput.write(output)
    }
} else {
    UnixSocket.send(message, to: socketPath, timeout: BridgeProtocol.hookTimeout)
}
exit(0)

/// Runs the user's status line command with the same JSON on stdin; its output
/// goes straight to Claude Code.
func startStatusLine(_ command: String, input: Data) -> Process? {
    // A command that doesn't read its stdin must not kill the hook.
    signal(SIGPIPE, SIG_IGN)
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/sh")
    process.arguments = ["-c", command]
    let stdin = Pipe()
    process.standardInput = stdin
    do { try process.run() } catch { return nil }
    try? stdin.fileHandleForWriting.write(contentsOf: input)
    try? stdin.fileHandleForWriting.close()
    return process
}
