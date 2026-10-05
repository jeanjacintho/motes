import Testing
@testable import Motes

struct ActivityLabelTests {
    @Test func fileTools() {
        #expect(ActivityLabel.tool("Edit", input: ["file_path": "/a/b/Invoice.swift"]) == "Edit Invoice.swift")
        #expect(ActivityLabel.tool("Write", input: ["file_path": "README.md"]) == "Write README.md")
        #expect(ActivityLabel.tool("Read", input: [:]) == "Read")
    }

    @Test func bashShowsTheFirstLine() {
        #expect(ActivityLabel.tool("Bash", input: ["command": "npm test\necho done"]) == "Bash npm test")
    }

    @Test func searchAndWeb() {
        #expect(ActivityLabel.tool("Grep", input: ["pattern": "TODO"]) == "Grep \"TODO\"")
        #expect(ActivityLabel.tool("WebFetch", input: ["url": "https://docs.swift.org/x"]) == "WebFetch docs.swift.org")
        #expect(ActivityLabel.tool("Task", input: ["description": "Review the diff"]) == "Task Review the diff")
    }

    @Test func mcpTools() {
        #expect(ActivityLabel.tool("mcp__github__create_issue", input: [:]) == "github: create_issue")
    }

    @Test func longLabelsAreTruncated() {
        let label = ActivityLabel.tool("Bash", input: ["command": String(repeating: "x", count: 200)])
        #expect(label.count == ActivityLabel.maxLength)
        #expect(label.hasSuffix("…"))
    }

    @Test func prompts() {
        #expect(ActivityLabel.prompt("Fix the login bug\nand add tests") == "› Fix the login bug")
    }

    @Test func summaryStripsMarkdown() {
        #expect(ActivityLabel.summary("\n## Done!\n\nAll tests pass.") == "Done!")
        #expect(ActivityLabel.summary("   \n  ") == nil)
    }
}
