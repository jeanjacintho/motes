# Changelog

All notable changes to Motes. Versions follow [Semantic Versioning](https://semver.org).

## [0.1.0] - Unreleased

First public version.

### Added
- The island: a panel over the notch (or a bar on Macs without one) that hides when nothing runs, shows a mote while agents work and opens on hover, click or ⌃⌥M.
- Motes: orbs of light with their own orbiting dust, nine states (idle, working, thinking, approval, question, error, finished, tired, sleeping), eyes that follow the pointer. Drawn with Core Animation: 0 % CPU hidden, under 2 % on screen.
- Your motes: name, folder, one of five forms and nine colors, and a CLI; creating one opens Terminal in the folder, tied to the mote. Sessions started elsewhere use the folder's mote or an automatic one.
- Claude Code integration through hooks: live sessions and activity, installed with a backup and a diff you confirm.
- Approve permissions (Deny / Always Allow / Allow) and answer Claude's questions from the notch, falling back to the terminal when you don't.
- Jump to a session: its Terminal tab, its conversation in the Claude desktop app, or its app.
- Launch at login and a configurable shortcut.
