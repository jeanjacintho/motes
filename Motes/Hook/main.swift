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
// Usage: motes-hook [--agent <name>] [--wait] [<EventName>]

var agent: String?
var eventName: String?
var canWait = false
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
    switch argument {
    case "--agent": agent = arguments.next()
    case "--wait": canWait = true
    default: if !argument.hasPrefix("-") { eventName = argument }
    }
}

let input = FileHandle.standardInput.readData(ofLength: BridgeProtocol.maxMessageBytes + 1)
let names = HookRelay.names(in: input)
let wait = canWait ? HookRelay.waitTime(eventName: names.event ?? eventName, toolName: names.tool) : nil

guard let message = HookRelay.message(
    payload: input, agent: agent, eventName: eventName,
    environment: ProcessInfo.processInfo.environment, tty: TerminalTTY.current(), wait: wait
) else { exit(0) }

let socketPath = BridgeProtocol.socketURL.path
if let wait {
    let reply = UnixSocket.request(message, to: socketPath, timeout: BridgeProtocol.hookTimeout, replyTimeout: wait)
    if let output = HookRelay.output(fromReply: reply) {
        FileHandle.standardOutput.write(output)
    }
} else {
    UnixSocket.send(message, to: socketPath, timeout: BridgeProtocol.hookTimeout)
}
exit(0)
