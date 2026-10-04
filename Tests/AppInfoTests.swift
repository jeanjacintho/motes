import Testing
@testable import Motes

struct AppInfoTests {
    @Test func versionAndBuild() {
        #expect(AppInfo.displayVersion(short: "0.1.0", build: "1") == "Motes 0.1.0 (1)")
    }

    @Test func versionWithoutBuild() {
        #expect(AppInfo.displayVersion(short: "0.1.0", build: nil) == "Motes 0.1.0")
        #expect(AppInfo.displayVersion(short: "0.1.0", build: " ") == "Motes 0.1.0")
    }

    @Test func missingVersion() {
        #expect(AppInfo.displayVersion(short: nil, build: "1") == "Motes")
        #expect(AppInfo.displayVersion(short: "", build: nil) == "Motes")
    }
}
