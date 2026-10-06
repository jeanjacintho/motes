# Motes — guide for AI coding agents

Motes is a native macOS app (`Motes/`) that lives in the MacBook notch and watches AI coding agent sessions (Claude Code first, then Codex, Gemini CLI, Cursor and others). Each agent has its own **mote**: an animated entity with its own personality. From the notch the user can see what each agent is doing, approve permissions, answer questions and jump to the right terminal.

Status: early stage. `docs/PROJECT.md` is the project vision, MVP scope and milestones. The mote visual style is described in `docs/PROJECT.md` §3.2.

## Where things are
- `Motes/Sources/` — all Swift code, one folder per area:
  - `App/` — app entry point, menu bar extra, app-wide helpers.
  - `Bridge/` — Unix socket server, hook payload parsing, decisions sent back to the hook.
  - `Sessions/` — session model, activity feed, focus rules, alert queue.
  - `Diff/` — `DiffEngine` and `FileChange`: live diffs built from hook payloads only (never reading files from disk).
  - `Usage/` — `PlanUsage`: Claude plan limits read from the status line (`rate_limits`), dropped at each window's reset.
  - `Island/` — `NSPanel`, notch geometry, state machine, click-through hit testing.
  - `Character/` — `MoteLayer` (Core Animation), `MoteView` (SwiftUI wrapper), states and personalities, and pure helpers (blink rhythm, badge layout).
  - `Motes/` — the user's motes (`Mote`, `MoteLibrary`, `MoteLauncher`), forms and palette (data only, no drawing code), and the automatic motes in `MoteRegistry`.
  - `Features/` — one folder per feature view: `NewMote/`, `Alerts/` (approval and question cards), `Diff/` (diff card), `Usage/` (plan usage gauge).
  - `Setup/` — hook installation (backup → merge → diff → confirm).
  - `Terminal/` — jumping to a session's window (`JumpTarget`, `TerminalJumper`). `ClaudeDesktopSessions` opens a Code session in the Claude desktop app through undocumented behavior (a `claude://code/continue` link and the app's session files, read only); it must always fall back to just activating the app.
  - `Settings/` — settings window, preferences (launch at login, shortcut).
- `Motes/Hook/` — `motes-hook`, the small Swift relay executable bundled in the app (`Contents/MacOS`) and copied to `~/Library/Application Support/Motes/bin/` at launch.
- `Motes/Shared/` — code compiled into both the app and the hook (socket protocol, relay, status line relay, socket helpers).
- `Motes/project.yml` — XcodeGen project. The `.xcodeproj` is generated and not committed.
- `Tests/` — unit tests for the pure logic (Swift Testing, `MotesTests` target).
- `docs/PROJECT.md` — vision, scope, milestones. `docs/INTEGRATION.md` — how agents send events to Motes.

## Build
```
cd Motes && xcodegen && xcodebuild -scheme Motes -configuration Debug build
cd Motes && xcodebuild -scheme Motes test
```
Bundle identifier: `app.motes.Motes`. Never change it (Keychain items, preferences and permissions depend on it). Version lives in `project.yml` (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`); there is no Info.plist file, it is generated. Builds are ad-hoc signed; pass `CODE_SIGN_IDENTITY="Developer ID Application"` to override.

## Rules
- Swift 6 with strict concurrency, SwiftUI + AppKit, macOS 15+. No third-party dependencies unless truly unavoidable.
- Motes are Core Animation layers: their idle life runs as repeating animations in the render server, and the app only touches them on a state change or a pointer move. Never animate a mote frame by frame from the app (it cost 7 % CPU when compact). No Rive, Lottie or bitmap images. Each mote is an orb of light with orbiting dust, no props; the body keeps its color and the state shows through eyes, motion, dust, halo and badge.
- One animation engine for all motes. A mote's personality (palette, shape, eyes, motion, quirks, voice) is **data** in a `MotePersonality`. Adding a mote for a new agent must not require touching the engine.
- Keep pure logic (state machine, hook parsing, focus rules, animation math) free of AppKit so it can be unit tested. Every new piece of pure logic gets tests.
- Keep files small and per feature. No god files: split a view or a service once it passes ~400 lines.
- Secrets live in the Keychain, never on disk or in git.
- No telemetry. Network calls only to services the user configured.
- Never block the agent: if the app doesn't answer within 300 ms, `motes-hook` exits 0 with no output and the agent carries on in its terminal.
- Never overwrite a user config file (`~/.claude/settings.json`, `~/.codex/…`, `~/.gemini/…`): dated backup, merge, show the diff, write only after the user confirms. Uninstall removes only Motes entries. The user's own `statusLine` command is kept inside Motes' (`--then`) and restored on uninstall.
- Never approve a permission or answer a question without an explicit click.
- Performance: 0 % CPU when the island is hidden, < 3 % when compact, < 100 MB of memory.
- The transparent panel must never swallow a click outside the island shape.
- Stable contract values, never rename: automatic mote IDs (`claude`, `codex`, `gemini`…), `MoteForm`, `MotePalette` and `MoteCLI` raw values (saved in `motes.json`), `MOTES_MOTE_ID`, and the socket keys.
- Distribution is GitHub only, ad-hoc signed (no Developer ID yet). Keep the signing identity a build variable, and keep the MVP independent of Automation / Accessibility permissions where possible, since ad-hoc builds may lose them on update.
- Characters, sounds and icon are 100 % original. Never copy assets from other projects.
- Every release adds its `CHANGELOG.md` section and bumps the version in `project.yml`; a `v<version>` tag publishes it (see CONTRIBUTING.md).

## Commits
Follow [Conventional Commits](https://www.conventionalcommits.org), in English:
```
<type>(<optional scope>): <subject>

<optional body>
```
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`, `style`, `revert`.
- Scope is the area touched, when it helps: `island`, `bridge`, `sessions`, `character`, `motes`, `setup`, `settings`, `hook`.
- Subject in the imperative mood ("add", not "added"), lowercase, no trailing period, 72 characters max.
- Body explains what and why, wrapped at 72 columns; use `-` bullets for several changes.
- Breaking changes (socket protocol, mote IDs, settings keys) add `!` after the type and a `BREAKING CHANGE:` footer.
- One logical change per commit.
