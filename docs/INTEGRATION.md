# Motes — agent integration

> Protocol version 1. It may still change until the first release.

Any tool that can run a command on its hook events, or write to a Unix domain socket, can send events to Motes and get its own mote next to Claude Code.

## The `motes_agent` field

Add the optional field `motes_agent` to any hook JSON payload. Motes routes every event with that name to the matching mote. If no personality is registered for that name, a default one is used.

**Validation:** the name must match `^[a-z0-9-]{1,24}$` (lowercase letters, digits and hyphens, 1–24 characters). An absent or invalid name routes the event to the Claude Code mote.

## Hook command

Call the Motes relay with `--agent <your-name>` and the event name:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "type": "command", "command": "\"$HOME/Library/Application Support/Motes/bin/motes-hook\" --agent my-tool" }
    ]
  }
}
```

Motes copies `motes-hook` to `~/Library/Application Support/Motes/bin/` at launch, so that path stays valid wherever the app lives. The event name comes from the payload's `hook_event_name`; it can also be passed as the last argument for tools that don't send it.

The relay reads the hook JSON on stdin, adds `motes_agent`, the protocol version `v` and the terminal context, then forwards it to the app. The terminal context is a `motes_terminal` object holding only these environment variables when set: `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERM_SESSION_ID`, `ITERM_SESSION_ID`, `__CFBundleIdentifier`, `TMUX`, `TMUX_PANE`, `KITTY_WINDOW_ID`, `WEZTERM_PANE`. Nothing else from the environment is ever sent.

If the environment has `MOTES_MOTE_ID` (set in terminals opened by Motes), the relay forwards it as `motes_mote` (lowercase letters, digits and hyphens, up to 40 characters). The session then belongs to that mote. Without it, Motes uses the mote owning the session's `cwd`, or the agent's automatic mote.

The relay never writes to stdout, so it never changes what the agent does.

If Motes isn't running or doesn't answer within 300 ms, the relay exits 0 with no output: **the agent is never blocked.**

## Payload format

You can also talk to the socket directly. Send one newline-terminated JSON object:

```json
{
  "v": 1,
  "hook_event_name": "UserPromptSubmit",
  "session_id": "my-session-1",
  "motes_agent": "my-tool",
  "motes_mote": "6f1c2a9e-1b2c-4d5e-8f90-123456789abc",
  "cwd": "/Users/me/code/project",
  "prompt": "Running task…",
  "motes_terminal": { "TERM_PROGRAM": "iTerm.app" }
}
```

- **Socket:** `~/Library/Application Support/Motes/motes.sock`. Folder `0700`, socket `0600`. Only connections from the same user are accepted (`getpeereid`).
- **Limits:** 1 MiB and 5 s per message, 32 connections at once. One message per connection.

## Answering from the notch

Started with `--wait`, the relay can wait for the user's answer on events that can be answered:

| Event | Waits up to | Shown in the notch |
|---|---|---|
| `PermissionRequest` | 110 s | Deny / Always Allow / Allow |
| `PreToolUse` for `AskUserQuestion` | 120 s | The questions and their options |

The relay adds `motes_wait` (seconds) to the message and keeps the connection open. The app replies with one line: the exact JSON the agent expects on stdout, which the relay prints. An empty reply, no reply in time, the app closing, or **Reply in Terminal**: the relay prints nothing and the agent asks in its terminal as usual. Never approving anything without a click is a hard rule: Motes never answers on its own.

Replies for Claude Code:
- Permission: `hookSpecificOutput.decision` with `behavior` `allow` or `deny`. **Always Allow** also sends `updatedPermissions` built from the request's `permission_suggestions` (rule strings become an `addRules` update with destination `local`, the project's `.claude/settings.local.json`).
- Question: `permissionDecision: "allow"` and `updatedInput` = the original `tool_input` plus `answers` (question text → label; several labels joined with `, `).

An alert is dropped without an answer when its hook gives up (connection closed) or its session moves on (`UserPromptSubmit`, `Stop`, `StopFailure`, `SessionEnd`). Answers are only offered for Claude Code for now; other agents' waiting events get no reply.

The installer registers waiting entries with a hook timeout above the wait: `PermissionRequest` (`--wait`, 120 s) and a `PreToolUse` group matching `AskUserQuestion` (`--wait`, 130 s), next to the listening entries (5 s).
- `v` is the protocol version. Missing means `1`.

## Supported events

Event names follow Claude Code hooks. For Claude Code, Settings → Claude Code → **Install Hooks** registers: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SubagentStop`, `SessionEnd`.

The mote lifecycle:

| Event | Effect |
|---|---|
| `SessionStart` | Creates the session under the agent's mote, state → idle |
| `UserPromptSubmit` | State → thinking; prompt shown in the feed |
| `PreToolUse` | State → working; tool + target shown in the feed (`Edit Foo.swift`, `Bash npm test`) |
| `PostToolUse` / `PostToolUseFailure` | Updates the feed; a failure stays working |
| `PermissionRequest` | State → approval; with `--wait`, an approval card (Claude Code only for now) |
| `PreToolUse` for `AskUserQuestion` | State → question; with `--wait`, a question card (Claude Code only for now) |
| `Notification` | Question state when input is needed; usage limit → tired |
| `Stop` | State → finished for 5 s, then idle; first line of `last_assistant_message` shown in the feed |
| `StopFailure` | State → error |
| `SubagentStart` / `SubagentStop` | Step added to the feed |
| `SessionEnd` | Removes the session |

A session is named after its `cwd` folder. Events for an unknown `session_id` create the session, so Motes catches up with sessions that started before it. A session quiet for 10 minutes falls asleep; one quiet for 2 hours (no `SessionEnd`, e.g. a killed terminal) is forgotten.

## Supporting a new CLI

1. Add a case to `MoteCLI` (command and agent name) and an automatic mote in `MoteRegistry` (a form plus a color, stable ID).
2. If the CLI's hook event names differ from Claude Code's, add a mapping to the canonical events in `Bridge/`.
3. Add a hook installer in `Setup/` following the backup → merge → diff → confirm flow, then set `hasHookSupport`.
4. Add tests for the event mapping.

## Quick test

With Motes running:

```sh
echo '{"hook_event_name":"UserPromptSubmit","session_id":"t1","prompt":"hello"}' \
  | "$HOME/Library/Application Support/Motes/bin/motes-hook" --agent demo
```

A "demo" mote should appear in the island.
