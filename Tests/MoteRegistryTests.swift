import Testing
@testable import Motes

struct MoteRegistryTests {
    @Test func idsAreUnique() {
        let ids = MoteRegistry.all.map(\.id)
        #expect(Set(ids).count == ids.count)
    }

    @Test func idsAreValidAgentNames() {
        // Same rule as `motes_agent` in docs/INTEGRATION.md.
        for mote in MoteRegistry.all {
            #expect(mote.id.wholeMatch(of: /[a-z0-9-]{1,24}/) != nil, "\(mote.id)")
        }
    }

    @Test func knownAgentGetsItsMote() {
        #expect(MoteRegistry.personality(for: "codex").id == "codex")
    }

    @Test func unknownAgentGetsTheDefaultMote() {
        #expect(MoteRegistry.personality(for: "some-new-tool").id == MotePersonality.default.id)
    }

    @Test func everyMoteHasItsOwnColor() {
        let colors = MoteRegistry.all.map { "\($0.color.r)-\($0.color.g)-\($0.color.b)" }
        #expect(Set(colors).count == colors.count)
    }
}
