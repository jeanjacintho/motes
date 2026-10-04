# Motes — guide for AI coding agents

Motes is a native macOS app (`Motes/`) that lives in the MacBook notch and watches AI coding agent sessions (Claude Code first, then Codex, Gemini CLI, Cursor and others). Each agent has its own **mote**: an animated entity with its own personality. From the notch the user can see what each agent is doing, approve permissions, answer questions and jump to the right terminal.

Status: early stage. `docs/PROJECT.md` is the project vision, MVP scope and milestones. The mote visual style is **not decided yet**: use a simple placeholder mote and don't invent a final look.

## Where things are
- `Motes/Sources/` — all Swift code, one folder per area:
  - `Bridge/` — Unix socket server, hook payload parsing, decisions sent back to the hook.
  - `Sessions/` — session model, activity feed, focus rules, alert queue.
  - `Island/` — `NSPanel`, notch geometry, state machine, click-through hit testing.
  - `Character/` — mote animation engine (pure logic) + `Canvas` view.
  - `Motes/` — one `MotePersonality` per agent (data only, no drawing code).
  - `Features/` — one folder per island view (Overview, Approval, Question, Finished…).
  - `Setup/` — hook installation (backup → merge → diff → confirm).
  - `Settings/` — settings window, Keychain, login item, global hotkey.
- `Motes/Hook/` — `motes-hook`, the small Swift relay executable bundled in the app.
- `Motes/project.yml` — XcodeGen project. The `.xcodeproj` is generated and not committed.
- `Tests/` — unit tests for the pure logic.
- `docs/PROJECT.md` — vision, scope, milestones. `docs/INTEGRATION.md` — how agents send events to Motes.

## Build
```
cd Motes && xcodegen && xcodebuild -scheme Motes -configuration Debug build
```

## Rules
- Swift 6 with strict concurrency, SwiftUI + AppKit, macOS 15+. No third-party dependencies unless truly unavoidable.
- Motes are drawn in code (`Canvas` + `TimelineView`): no Rive, Lottie or bitmap images.
- One animation engine for all motes. A mote's personality (palette, shape, eyes, motion, quirks, voice) is **data** in a `MotePersonality`. Adding a mote for a new agent must not require touching the engine.
- Keep pure logic (state machine, hook parsing, focus rules, animation math) free of AppKit so it can be unit tested. Every new piece of pure logic gets tests.
- Keep files small and per feature. No god files: split a view or a service once it passes ~400 lines.
- Secrets live in the Keychain, never on disk or in git.
- No telemetry. Network calls only to services the user configured.
- Never block the agent: if the app doesn't answer within 300 ms, `motes-hook` exits 0 with no output and the agent carries on in its terminal.
- Never overwrite a user config file (`~/.claude/settings.json`, `~/.codex/…`, `~/.gemini/…`): dated backup, merge, show the diff, write only after the user confirms. Uninstall removes only Motes entries.
- Never approve a permission or answer a question without an explicit click.
- Performance: 0 % CPU when the island is hidden, < 3 % when compact, < 100 MB of memory.
- The transparent panel must never swallow a click outside the island shape.
- Mote IDs (`claude`, `codex`, `gemini`…) are stable contract values (UserDefaults, hook routing): never rename an existing one.
- Distribution is GitHub only, ad-hoc signed (no Developer ID yet). Keep the signing identity a build variable, and keep the MVP independent of Automation / Accessibility permissions where possible, since ad-hoc builds may lose them on update.
- Characters, sounds and icon are 100 % original. Never copy assets from other projects.
- Every release adds its `CHANGELOG.md` section and bumps the version in `project.yml`.

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
