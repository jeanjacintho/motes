import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let island = IslandController()
    let sessions = SessionController()
    let library = MoteLibrary()
    let hookInstaller: ClaudeHookInstaller
    let newMoteWindow: NewMoteWindowController

    override init() {
        // The hook must be in place before the installer checks its path.
        HookBinaryInstaller.installIfNeeded()
        hookInstaller = ClaudeHookInstaller()
        newMoteWindow = NewMoteWindowController(library: library)
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        island.start()
        island.setMotes(library.motes)
        island.onOpenMote = { mote in try? MoteLauncher.open(mote) }
        island.onNewMote = { [newMoteWindow] in newMoteWindow.show() }
        sessions.moteForFolder = { [library] cwd in Mote.owner(of: cwd, in: library.motes)?.id }
        sessions.onChange = { [island] sessions, focused in
            island.setSessions(sessions, focused: focused)
        }
        sessions.start()
        observeLibrary()
    }

    func applicationWillTerminate(_ notification: Notification) {
        sessions.stop()
    }

    /// Keeps the island in sync with the library.
    private func observeLibrary() {
        withObservationTracking {
            _ = library.motes
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.island.setMotes(self.library.motes)
                self.observeLibrary()
            }
        }
    }
}
