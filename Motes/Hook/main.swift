import Foundation

// motes-hook: called by coding agents on each hook event.
// Reads the event JSON on stdin, adds the agent name and the terminal context,
// and forwards it to Motes over its Unix socket. It never writes to stdout and
// always exits 0 quickly, so the agent is never blocked or changed by Motes.
//
// Usage: motes-hook [--agent <name>] [<EventName>]

var agent: String?
var eventName: String?
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
    if argument == "--agent" {
        agent = arguments.next()
    } else if !argument.hasPrefix("-") {
        eventName = argument
    }
}

let input = FileHandle.standardInput.readData(ofLength: BridgeProtocol.maxMessageBytes + 1)
if let message = HookRelay.message(
    payload: input, agent: agent, eventName: eventName,
    environment: ProcessInfo.processInfo.environment
) {
    UnixSocket.send(message, to: BridgeProtocol.socketURL.path, timeout: BridgeProtocol.hookTimeout)
}
exit(0)
