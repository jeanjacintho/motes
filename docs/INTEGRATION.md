# Motes — agent integration

> Draft: this protocol is a proposal and may change until the first release.

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
      { "type": "command", "command": "\"/Applications/Motes.app/Contents/MacOS/motes-hook\" --agent my-tool UserPromptSubmit" }
    ]
  }
}
```

The relay reads the hook JSON on stdin, adds the terminal context (`TERM_PROGRAM`, `ITERM_SESSION_ID`, `TERM_SESSION_ID`, `__CFBundleIdentifier`, tty, `cwd`) and `motes_agent`, then forwards it to the app.

If Motes isn't running or doesn't answer within 300 ms, the relay exits 0 with no output: **the agent is never blocked.**

## Payload format

You can also talk to the socket directly. Send one newline-terminated JSON object:

```json
{
  "v": 1,
  "hook_event_name": "UserPromptSubmit",
  "session_id": "my-session-1",
  "motes_agent": "my-tool",
  "cwd": "/Users/me/code/project",
  "prompt": "Running task…"
}
```

- **Socket:** `~/Library/Application Support/Motes/motes.sock`. Folder `0700`, socket `0600`. Only connections from the same user are accepted (`getpeereid`).
- **Limits:** 1 MiB and 5 s per message.
- `v` is the protocol version. Missing means `1`.

## Supported events

Event names follow Claude Code hooks. The mote lifecycle:

| Event | Effect |
|---|---|
| `SessionStart` | Creates the session under the agent's mote, state → idle |
| `UserPromptSubmit` | State → thinking; prompt shown in the feed |
| `PreToolUse` | State → working; tool + target shown in the feed (`Edit Foo.swift`, `Bash npm test`) |
| `PostToolUse` / `PostToolUseFailure` | Updates the feed; a failure stays working |
| `PermissionRequest` | Approval card (Claude Code only for now) |
| `PreToolUse` for `AskUserQuestion` | Question card (Claude Code only for now) |
| `Notification` | Question or rate-limit state when applicable |
| `Stop` | State → finished for a few seconds |
| `StopFailure` | State → error |
| `SubagentStart` / `SubagentStop` | Step added to the feed |
| `SessionEnd` | Removes the session; the mote stays if it is declared, otherwise it leaves |

`PermissionRequest` from a third-party agent is answered immediately with no decision for now: the relay writes nothing and the agent asks again in its terminal.

## Adding a mote for a new agent

1. Add a `MotePersonality` in `Motes/Sources/Motes/` with a new stable ID (never rename it later).
2. If the agent's hook event names differ from Claude Code's, add a mapping to the canonical events in `Bridge/`.
3. Add a hook installer in `Setup/` following the backup → merge → diff → confirm flow.
4. Add tests for the event mapping.

## Quick test

With Motes running:

```sh
echo '{"hook_event_name":"UserPromptSubmit","session_id":"t1","prompt":"hello","motes_agent":"demo"}' \
  | /Applications/Motes.app/Contents/MacOS/motes-hook --agent demo UserPromptSubmit
```

A "demo" mote should appear in the island.
