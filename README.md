# Motes

**Little orbs of light in your Mac's notch that keep an eye on your AI coding agents.**

Each mote is a companion for one of your projects. It shows what its agent is doing (working, thinking, waiting for you, done, tired, asleep), lets you approve permissions and answer questions right from the notch, and takes you back to the right window in one click.

- **Live sessions:** Claude Code in Terminal, the Claude desktop app or your IDE shows up in the notch as it works.
- **Approve and answer from the notch:** permission requests get **Deny / Always Allow / Allow**; Claude's questions show their options. Nothing is ever approved without your click; if you don't answer, Claude asks in its terminal as usual.
- **Your motes:** create one per project with a name, a folder, one of five temperaments and one of nine colors. Motes opens Terminal in that folder running the agent, tied to the mote.
- **Jump back:** click a session to bring its Terminal tab, its Claude desktop conversation or its app to the front.
- **Light on your Mac:** 0 % CPU when hidden, under 2 % while a mote is on screen, about 20 MB of memory. No telemetry, no account, no network calls.

Requirements: macOS 15 or later. Agents: Claude Code and Codex (live sessions and approvals; questions are Claude Code only). Gemini CLI opens in Terminal but doesn't report its state yet.

## Install

1. Download `Motes-<version>.zip` from [Releases](../../releases) and check it if you like: `shasum -a 256 -c SHA256SUMS`.
2. Unzip it and move **Motes.app** to `/Applications`.
3. Open it. Motes isn't notarized by Apple yet, so macOS blocks the first launch: open **System Settings → Privacy & Security** and click **Open Anyway** next to Motes. Or, in Terminal:
   ```sh
   xattr -dr com.apple.quarantine /Applications/Motes.app
   ```
4. Motes lives in the menu bar (✨) and in the notch.

Builds are signed ad-hoc, so after an update macOS may ask again for the permissions you gave Motes (controlling Terminal, launch at login).

## Set up

1. Menu ✨ → **Settings… → Claude Code → Install Hooks…**. Motes shows exactly what it will add to `~/.claude/settings.json`, backs the file up and writes only when you confirm. **Remove Hooks** takes out only Motes' entries.
   For Codex: **Settings… → Codex → Install Hooks…** (`~/.codex/hooks.json`), then run `/hooks` in Codex once and trust the Motes hooks.
2. Optional: **New Mote…** (⌘N) to create a mote for a project, **Launch at login**, and the shortcut to open the island (⌃⌥M by default).

If Motes isn't running, Claude Code works exactly as before: the hook gives up in a fraction of a second.

## Build from source

Requirements: Xcode 16 or later, [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
brew install xcodegen
git clone <this repository>
cd motes/Motes
xcodegen
open Motes.xcodeproj
```

Run the tests with `xcodebuild -scheme Motes test`. Building it yourself also means macOS doesn't block the first launch.

## How it works

- `motes-hook`, a small binary inside the app, receives Claude Code's hook events and forwards them over a private Unix socket. For permissions and questions it waits for your answer. See [docs/INTEGRATION.md](docs/INTEGRATION.md) to plug in another agent.
- The island is a borderless panel over the notch; motes are Core Animation layers, so their breathing, orbit and blinks run in the system's render server, not in the app.
- More in [docs/PROJECT.md](docs/PROJECT.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE).
