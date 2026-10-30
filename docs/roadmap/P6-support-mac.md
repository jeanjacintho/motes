# P6 · Support and the Mac

> Back to [ROADMAP](../ROADMAP.md) · Design refs: DESIGN §3 (canonical scenario), §10 (security), §12 (channels)

**Goal of the phase:** the canonical scenario works. A Support bot answers customers on the owner's WhatsApp, a bug report becomes a card through a Triage bot, a Dev bot fixes it, and the Boss tells the owner. Office bots that need the Mac act through Latch.

**Gate P6:** from a second phone, as a "customer", report a bug to the owner's WhatsApp. Without the owner touching anything: the Support bot answers, a card appears with reproduction steps, a dev run opens a PR, and the Boss reports it on iMessage. Separately, an office bot performs one Mac action through Latch and it shows in both the Latch audit and the Motes audit.

---

## P6-01 · WhatsApp adapter

### P6-01-01 · Protocol notes and fake
**What this is:** pinning down how Motes uses the WhatsApp Web multi-device protocol (Baileys) and its risks before coding.
**Steps:**
1. Write `packages/channels/whatsapp/NOTES.md`: pairing, session files, events used, media handling, known causes of bans (bulk sends, new numbers, fast replies to strangers), the library's license and version policy.
2. A fake socket for tests emitting recorded events.
**Done when:**
- [ ] Notes reviewed by the owner; fake socket used by the next cards.
**Deps:** P4-05-01 · **Touches:** channels · **Size:** S

### P6-01-02 · Pairing and session storage
**Steps:**
1. Settings flow: "connect WhatsApp" shows a QR code (rendered in the app) from the adapter; on success store the session (credentials) encrypted with a key in the Keychain.
2. "Disconnect" logs out and deletes the session.
**Done when:**
- [ ] Manual: pair a test number, restart the server, stay connected without a new QR.
**Deps:** P6-01-01, P2-05-01 · **Touches:** channels, views · **Size:** M

### P6-01-03 · Inbound messages
**Steps:**
1. Normalize text, images, audio (stored, not transcribed yet), documents and replies into `InboundMessage`; `isOwner` from P4-05-02.
2. Ignore status updates, broadcasts and groups unless listed (P6-02-01).
**Done when:**
- [ ] Fake-socket tests for each message type and for ignored sources.
**Deps:** P6-01-02 · **Touches:** channels · **Size:** M

### P6-01-04 · Outbound messages
**Steps:**
1. Send text and media; mark as read only when a bot actually handles the message.
2. Human-like pacing: typing indicator and a small delay proportional to length (configurable), conservative per-chat and global rate limits.
**Done when:**
- [ ] Tests: rate limits hold under a burst; read receipts only after handling.
**Deps:** P6-01-03, P4-05-04 · **Touches:** channels · **Size:** M

### P6-01-05 · Health and reconnect
**Steps:**
1. Reconnect with backoff on drops; detect logged-out sessions and report `down` with "re-pair needed".
2. Inbox item and Boss `now` message (on another channel) when WhatsApp is down for more than 10 minutes.
**Done when:**
- [ ] Fake-socket test: a forced logout reports `down` and notifies.
**Deps:** P6-01-04 · **Touches:** channels · **Size:** S

---

## P6-02 · Third-party conversations

### P6-02-01 · Chat-to-bot binding
**What this is:** which bot owns which external conversations.
**Steps:**
1. Settings per channel: default bot for unknown chats (e.g. Support), per-chat overrides, allow or ignore groups.
2. Unbound chats are ignored and logged.
**Done when:**
- [ ] Test: a message from an unbound chat never wakes a bot.
**Deps:** P6-01-03 · **Touches:** channels, domain · **Size:** S

### P6-02-02 · Contacts
**What this is:** a record per external person (customer), so bots and cards can refer to them.
**Steps:**
1. Table `contacts` (`id`, `channel`, `handle`, `displayName`, `notes`, `firstSeenAt`); linked to conversations and cards.
2. Contact page in the app `UI · visual TBD`.
**Done when:**
- [ ] Test: two messages from the same handle map to one contact.
**Deps:** P6-02-01 · **Touches:** db, domain, views · **Size:** S

### P6-02-03 · Reply policy for third parties
**Steps:**
1. Per bot: allowed topics, forbidden actions (no promises of dates, no prices unless in the knowledge base), when to hand to the owner (`ask_owner`), business hours message.
2. Every message to a third party is a `channel.send` capability; default allow for the bound bot in its bound chats, approval anywhere else.
**Done when:**
- [ ] Gateway tests: Support can reply in its chats, cannot message a new number without approval.
**Deps:** P6-02-01, P2-04-02 · **Touches:** bots, security · **Size:** M

---

## P6-03 · Support and Triage bots

### P6-03-01 · Knowledge base
**What this is:** the documents the Support bot answers from (FAQ, product notes).
**Steps:**
1. Use skills (P5-06) as the knowledge base: a `support-kb` skill attached to Support.
2. Tool `kb.search` (lexical first) returning passages with their source.
**Done when:**
- [ ] Test: a fixture question retrieves the right passage.
**Deps:** P5-06-02 · **Touches:** bots · **Size:** S

### P6-03-02 · Support bot template
**Steps:**
1. Seeded skill folder `bots/support/` (office bot): `cheap_llm` tier, frontier forbidden; classification `bug|question|complaint|other` at the classifier tier (P3-05).
2. Answers questions from the knowledge base; on `bug`, collects missing details from the customer (what, where, when, screenshot), then hands off to Triage with the conversation and contact.
3. Tells the customer the report was received; never promises a date.
**Done when:**
- [ ] Fixture conversations route correctly with no frontier call.
**Deps:** P6-03-01, P6-02-03, P5-04-01, P3-05-03 · **Touches:** bots · **Size:** M

### P6-03-03 · Triage bot template
**Steps:**
1. Seeded skill folder `bots/triage/` (office bot): turns a handoff into a card (title, steps to reproduce, expected vs actual, links to the conversation and contact, label `bug` + `customer`), picks the project and repository, assigns the Dev bot or leaves it in `todo` with a reason.
2. Detects duplicates against open cards (lexical first) and links instead of creating.
**Done when:**
- [ ] Test: two similar reports produce one card with two linked conversations.
**Deps:** P6-03-02, P5-04-04 · **Touches:** bots · **Size:** M

### P6-03-04 · Closing the loop with the customer
**Steps:**
1. When the card linked to a customer conversation reaches `done`, the chain wakes Support, which tells the customer the issue is fixed (approval required the first time per bot, then optionally always-allowed).
**Done when:**
- [ ] Test with fakes: card done → one message to the customer.
**Deps:** P6-03-03, P5-04-04 · **Touches:** bots · **Size:** S

---

## P6-04 · Latch for office bots on the Mac

### P6-04-01 · Relay and Latch notes, fake relay
**What this is:** pinning down how Motes reaches Latch's MCP server through the Plow relay.
**Steps:**
1. Read `plow/latch` (DESIGN, SECURITY, MCP server instructions) and write `packages/security/latch/NOTES.md`: relay URL and auth, tool list and schemas, how approvals and denials come back, timeouts.
2. A fake MCP server mimicking Latch's tools and decisions for tests.
**Done when:**
- [ ] Notes reviewed by the owner; fake used by the next cards.
**Deps:** P4-02-03 · **Touches:** security · **Size:** S

### P6-04-02 · MCP client through the relay
**Steps:**
1. MCP client (official TypeScript SDK) connecting to `PLOW_MCP_URL` with the agent credential from the secret store.
2. Tool discovery at start and on reconnect; results returned as data blocks.
**Done when:**
- [ ] Fake-relay tests: list tools, call one, handle a denial and a timeout.
**Deps:** P6-04-01, P2-05-01 · **Touches:** security · **Size:** M

### P6-04-03 · Latch tools in the tool registry
**Steps:**
1. Register each Latch tool as a Motes tool whose capability is `mac.latch` with the tool name and arguments, so Motes audits it too; Motes default policy allows it, because Latch decides.
2. Per bot: which Latch tools are exposed (`bot.yaml` `latchTools`).
**Done when:**
- [ ] Test: a bot without `latchTools` cannot see or call them; every call creates a Motes audit entry.
**Deps:** P6-04-02, P2-04-01 · **Touches:** security, bots · **Size:** M

### P6-04-04 · Mac actions only through Latch
**Steps:**
1. Office bots have no Motes-native tools that touch the Mac's files, shell or browser; such needs route to Latch tools.
2. A boundaries rule: `packages/bots` must not import `node:child_process` or `node:fs` write APIs.
**Done when:**
- [ ] The boundaries check fails on a fixture violating the rule.
**Deps:** P6-04-03, P0-01-05 · **Touches:** bots, scripts · **Size:** S

### P6-04-05 · Canonical scenario end to end
**What this is:** an automated test of DESIGN §3 with fakes, plus the manual gate with real services.
**Steps:**
1. E2E test: fake WhatsApp customer message → Support → Triage → card → fake dev run → PR (fake `gh`) → review → Boss message on fake Plow.
2. Manual checklist for the real run in the gate.
**Done when:**
- [ ] The e2e test passes in CI; Gate P6 passes by hand.
**Deps:** P6-03-04, P6-04-04 · **Touches:** e2e · **Size:** M
