import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let island = IslandController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        island.start()
    }
}
