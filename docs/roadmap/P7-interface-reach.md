# P7 · Interface and reach

> Back to [ROADMAP](../ROADMAP.md) · Design refs: DESIGN §13 (interface)

**Status: outline.** This phase is detailed with the owner when it starts. The visual design is decided together, so the cards below are candidates, not commitments. When the phase starts, each epic is expanded into full cards in the same format as the other phases.

**Gate P7:** defined with the owner.

---

## P7-01 · Visual design
- Design session with the owner: mockups of the main screens (bots-as-contacts messaging layout next to the board, card detail, run log, approvals, Boss chat).
- Final tokens (color, typography, spacing, motion) replacing the P0 placeholders.
- Restyle every `UI · visual TBD` screen from P1–P6.
- Empty states, onboarding (first run: pair, add a machine, add a project, talk to the Boss).

## P7-02 · Web app
- `apps/web` with Vite and a browser router adapter for `views`.
- Served by the hub over Tailscale; same pairing flow.

## P7-03 · MacBook Air runtime
- Install the daemon on the Air; repository paths per machine; runtime picker per project and per card.
- Work away from home over Tailscale; offline Air does not block cards meant for the Mac mini.

## P7-04 · Notch client
- `jeanjacintho/motes-notch` talks to the Motes server: bot status, live run state, approvals and questions with one click, quick reply to the Boss.

## P7-05 · Mobile client
- A phone client for the board, inbox and Boss chat (technology decided at the start of the phase).

## P7-06 · More channels
- Native iMessage adapter (`chat.db` + AppleScript, Full Disk Access) to remove the Plow dependency for the line.
- WhatsApp Business API adapter for higher-volume support.

## P7-07 · Hardening
- OS sandbox (seatbelt profile) for dev runs (DESIGN §10).
- Desktop packaging, signing, notarization and auto-update.
- Backups of Postgres and the data directory.
