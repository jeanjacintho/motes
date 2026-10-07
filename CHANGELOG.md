# Changelog

All notable changes to Motes. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added
- Codex support: install its hooks from Settings (`~/.codex/hooks.json`), see its sessions live and allow or deny its permission requests from the notch. Patch edits show the files they touch.
- Live diffs: a session's last edit shows its +N −M in the island; click it to read the diff and step through the session's edits. Built from what the agent sends, never read from disk.
- GitHub: each session row shows its branch's open pull request with its checks and reviews; click to open it. Turn it on in Settings → GitHub. It uses the GitHub CLI's login or a token kept in the Keychain, and only reads.
- Claude plan usage: the open island shows how much of the 5-hour and weekly limits is used, read from Claude Code's status line. Near a limit, it shows when the window resets and idle Claude motes look tired. Your own status line keeps working: Motes runs it and restores it when you remove the hooks.

## [0.1.0] - 2026-10-05

First public version.

### Added
- The island: a panel over the notch (or a bar on Macs without one) that hides when nothing runs, shows a mote while agents work and opens on hover, click or ⌃⌥M.
- Motes: orbs of light with their own orbiting dust, nine states (idle, working, thinking, approval, question, error, finished, tired, sleeping), eyes that follow the pointer. Drawn with Core Animation: 0 % CPU hidden, under 2 % on screen.
- Your motes: name, folder, one of five forms and nine colors, and a CLI; creating one opens Terminal in the folder, tied to the mote. Sessions started elsewhere use the folder's mote or an automatic one.
- Claude Code integration through hooks: live sessions and activity, installed with a backup and a diff you confirm.
- Approve permissions (Deny / Always Allow / Allow) and answer Claude's questions from the notch, falling back to the terminal when you don't.
- Jump to a session: its Terminal tab, its conversation in the Claude desktop app, or its app.
- Launch at login and a configurable shortcut.
