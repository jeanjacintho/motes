import Foundation
import Testing
@testable import Motes

struct TerminalMessageTests {
    func session(_ state: MoteState, terminal: [String: String]) -> AgentSession {
        AgentSession(id: "s1", agent: "claude", name: "app", cwd: "/code/app", state: state,
                     terminal: terminal, startedAt: .now, lastEventAt: .now, stateChangedAt: .now)
    }

    let terminalTab = ["TERM_PROGRAM": "Apple_Terminal", "tty": "/dev/ttys004"]

    @Test func terminalTabsAndDesktopChatsCanBeTypedInto() {
        #expect(TerminalMessage.availability(of: session(.working, terminal: terminalTab)) == .terminal(tty: "/dev/ttys004"))
        #expect(TerminalMessage.availability(of: session(.idle, terminal: ["__CFBundleIdentifier": "com.anthropic.claudefordesktop"])) == .claudeDesktop(sessionID: "s1"))
        #expect(TerminalMessage.availability(of: session(.idle, terminal: ["TERM_PROGRAM": "Apple_Terminal"])) == .unsupported)
        #expect(TerminalMessage.availability(of: session(.idle, terminal: ["TERM_PROGRAM": "iTerm.app", "tty": "/dev/ttys004"])) == .unsupported)
        #expect(TerminalMessage.availability(of: session(.idle, terminal: [:])) == .unsupported)
    }

    @Test func neverTypesIntoAPendingApprovalOrQuestion() {
        // Typed text could answer the terminal's prompt.
        #expect(TerminalMessage.availability(of: session(.approval, terminal: terminalTab)) == .waitingForAnswer)
        #expect(TerminalMessage.availability(of: session(.question, terminal: terminalTab)) == .waitingForAnswer)
        let desktop = ["__CFBundleIdentifier": "com.anthropic.claudefordesktop"]
        #expect(TerminalMessage.availability(of: session(.approval, terminal: desktop)) == .waitingForAnswer)
    }

    @Test func messagesStayOnOneLine() {
        #expect(TerminalMessage.line(text: "fix the\nlogin\r\nbug\tnow") == "fix the login  bug now")
        #expect(TerminalMessage.line(text: "a\u{2028}b") == "a b")
    }

    @Test func controlCharactersNeverReachTheTerminal() {
        // ESC sequences, ^C and DEL would act on the terminal, not be read as text.
        #expect(TerminalMessage.line(text: "hi\u{1B}[2J\u{03}\u{7F} there") == "hi[2J there")
        #expect(TerminalMessage.line(text: "é ✨ 日本") == "é ✨ 日本")
    }

    @Test func filesComeFirstQuotedWhenNeeded() {
        let line = TerminalMessage.line(text: "look at these", files: ["/code/app/Login.swift", "/Users/me/My Docs/spec.pdf"])
        #expect(line == "/code/app/Login.swift \"/Users/me/My Docs/spec.pdf\" look at these")
        #expect(TerminalMessage.line(text: "", files: ["/a/b.png"]) == "/a/b.png")
        #expect(TerminalMessage.quoted("/a/\"odd\" name") == "\"/a/odd name\"")
    }

    @Test func nothingToSendIsNil() {
        #expect(TerminalMessage.line(text: "") == nil)
        #expect(TerminalMessage.line(text: "  \n\t ") == nil)
        #expect(TerminalMessage.line(text: "\u{1B}") == nil)
    }

    @Test func longMessagesAreCut() {
        let line = TerminalMessage.line(text: String(repeating: "a", count: TerminalMessage.maxLength + 50))
        #expect(line?.count == TerminalMessage.maxLength)
    }
}
