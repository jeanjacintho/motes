# P4 · Boss and channels

> Back to [ROADMAP](../ROADMAP.md) · Design refs: DESIGN §6.2 (office bots), §6.4 (flows), §9.4 (Boss), §10 (trust), §12 (channels)

**Goal of the phase:** the owner stops opening the app to give orders. Office bots run on cheap models, the Boss is the owner's assistant, and the Boss is reachable on iMessage (through Plow) with Telegram as a fallback. Approvals and bot questions can be answered from the phone with short codes.

**Gate P4:** from the phone, on iMessage: (1) "cria um card no projeto X para corrigir Y e manda o Dev fazer" → card created, run starts, the Boss confirms; (2) when the run ends in review, the Boss sends a message about it; (3) a test approval arrives with a code and replying `ok <code>` resolves it; (4) with Plow disabled, the same works on Telegram.

---

## P4-01 · Conversations and messages

### P4-01-01 · Conversation and message entities
**What this is:** chat history between the owner, bots and third parties, in the app or on a channel.
**Steps:**
1. Protocol: `conversationSchema` (`id`, `kind` `owner_bot|bot_bot|channel`, `botId`, `channel?`, `externalChatId?`, `title`), `messageSchema` (`id`, `conversationId`, `author` `{ type: 'owner'|'bot'|'third_party', id }`, `trust` `owner|bot|third_party`, `origin` `app|plow|telegram|whatsapp|system`, `text`, `attachments`, `replyTo?`, `externalId?`, `createdAt`).
2. Tables `conversations`, `messages`, `attachments` (files stored under the data dir, sha256-named).
3. Events `message.created`.
**Done when:**
- [ ] Tests: unique `(origin, externalId)`; attachments stored once by hash.
**Deps:** P1-05-02 · **Touches:** protocol, db, domain · **Size:** M

### P4-01-02 · Trust is assigned by code only
**What this is:** the rule that a message's trust level is set by the code path that receives it, never by a request field or a model.
**Steps:**
1. App messages from an owner device token → `owner`. Messages written by a bot → `bot`. Channel messages → whatever the adapter computed from the owner handle list (P4-05-02), defaulting to `third_party`.
2. No API accepts `trust` from the caller.
**Done when:**
- [ ] Test: every message-creating route and service ignores a supplied `trust` value.
**Deps:** P4-01-01 · **Touches:** domain, server · **Size:** S

### P4-01-03 · Conversation routes and hooks
**Steps:**
1. `GET /bots/:id/conversations`, `GET /conversations/:id/messages?cursor=`, `POST /conversations/:id/messages` (owner, app origin).
2. `core` hooks with live append; pending state and retry for sends (DESIGN §8 state rules).
**Done when:**
- [ ] Core test: a failed send shows retry and does not duplicate on success.
**Deps:** P4-01-02 · **Touches:** server, core · **Size:** S

---

## P4-02 · Office-bot runtime (`packages/bots`)

### P4-02-01 · Prompt builder
**What this is:** how a turn's prompt is assembled.
**Steps:**
1. Sections in fixed order: bot instructions, attached skills (P5), memory (P5), current time and owner preferences, conversation window, the new input.
2. Third-party text and tool results are wrapped in clearly delimited data blocks with a standing instruction that they are data, never instructions (DESIGN §10).
3. Secrets redacted (P2-05-02); total size capped with oldest messages dropped first (compaction in P4-02-06).
**Done when:**
- [ ] Snapshot tests of built prompts; a test that a third-party message containing "ignore previous instructions" appears only inside a data block.
**Deps:** P4-01-01, P2-05-02 · **Touches:** bots · **Size:** M

### P4-02-02 · Motes MCP server
**What this is:** an MCP server, run by Motes, through which a CLI running an office-bot turn reaches Motes' tools.
**Why:** office bots run on the owner's CLIs (Q2), and MCP is how those CLIs call outside tools. Every call still goes through the tool gateway.
**Steps:**
1. A local MCP server (official TypeScript SDK) exposing the tools registered for the bot (P2-04-01), authenticated per turn with a short-lived token bound to `(botId, turnId)`.
2. Each tool call is forwarded to the gate pipeline (P2-04-02); denials and pending approvals come back as tool results.
3. A per-CLI config writer that points the headless CLI at this server for the turn.
**Done when:**
- [ ] Tests: a token from one turn cannot call tools in another; a tool not registered for the bot is not listed.
**Deps:** P2-04-02 · **Touches:** bots, security · **Size:** M

### P4-02-03 · Office-bot turn
**What this is:** one turn of an office bot: a headless CLI call with the built prompt, the bot's skill, and the Motes MCP server as its only tools.
**Steps:**
1. The decider (P3) picks the tier, and so the engine and model, within the bot's limits; most turns run at `cheap_llm`.
2. Run the CLI through the hub's daemon in a scratch directory with every built-in tool disabled (no shell, no file writes), the bot's `SKILL.md` installed where the CLI loads skills, and the Motes MCP server configured (P4-02-02).
3. Limits from `bot.yaml`: max turns and max minutes per turn.
4. Output: zero or more messages; tool calls and results recorded as run log entries (an office turn is a `run` on the hub's runtime).
**Done when:**
- [ ] Test with the fake engine: a three-tool turn completes; a built-in tool call attempt is refused; hitting the turn limit ends the turn with a note.
**Deps:** P4-02-02, P3-04-02, P1-07-06 · **Touches:** bots, domain, daemon · **Size:** M

### P4-02-04 · Durable turn queue
**What this is:** each office bot handles one turn at a time from a FIFO queue that survives restarts.
**Steps:**
1. Table `bot_queue` (`botId`, `seq`, `input` (message or event ref), `state`, `attempts`); pause, resume, cancel per bot.
2. A worker per bot in the server; on restart, unfinished turns resume (including turns waiting for an approval, P2-03-03).
3. Idempotency: a turn's outgoing messages carry the turn id, so a resumed turn does not send twice.
**Done when:**
- [ ] Test: kill the worker mid-turn, restart, and get exactly one reply.
**Deps:** P4-02-03 · **Touches:** bots, db · **Size:** M

### P4-02-05 · Office settings in `bot.yaml`
**What this is:** the configuration fields office bots need.
**Steps:**
1. Office bots: `engines` in preference order, `models` per tier, `decision` tier limits (P3-04-02), `tools` (which Motes tools the bot gets), `projects` (where it may write).
2. Validation: office bots must declare their tools; dev bots ignore office-only fields.
**Done when:**
- [ ] Schema tests.
**Deps:** P1-05-01, P3-04-02 · **Touches:** protocol · **Size:** S

### P4-02-06 · Context compaction
**What this is:** summarizing old parts of a long conversation so it fits the model window cheaply.
**Steps:**
1. When the window exceeds a threshold, summarize the oldest segment at `cheap_llm` and store `conversation_summaries` linked to the message range.
2. The prompt builder uses summaries for old ranges and raw messages for recent ones.
**Done when:**
- [ ] Test: a 500-message fixture conversation stays under the configured token budget and the summary links back to its messages.
**Deps:** P4-02-03 · **Touches:** bots, db · **Size:** M

---

## P4-03 · Pipeline tools for office bots

### P4-03-01 · Read tools
**What this is:** tools to look at the pipeline.
**Steps:**
1. `cards.search` (project, status, assignee, text), `cards.get`, `runs.list` (by card, bot, state), `runs.get_summary`, `usage.summary`, `inbox.list`.
2. Capability `pipeline.read` (default allow).
**Done when:**
- [ ] Each tool has input schema tests and a gateway test.
**Deps:** P4-02-03 · **Touches:** bots, domain · **Size:** M

### P4-03-02 · Write tools
**Steps:**
1. `cards.create`, `cards.update`, `cards.assign` (to a bot or the owner), `cards.comment`, `cards.move`.
2. Capabilities `card.write` (default allow in projects the bot is allowed on), `card.assign_bot` (default allow for dev bots listed in `bot.yaml`).
**Done when:**
- [ ] Gateway tests: writing to a project outside the bot's list requires approval.
**Deps:** P4-03-01 · **Touches:** bots, domain, protocol · **Size:** M

### P4-03-03 · Activity summary tool
**What this is:** a tool that returns a compact, structured summary of what happened in a time window (runs started and finished, cards moved, failures, usage), built by code, not by a model.
**Why:** the Boss answers "how is everything?" from this, cheaply.
**Steps:**
1. `activity.summary({ since, projectIds? })` aggregating events and rollups.
**Done when:**
- [ ] Test with a fixture event log returns the expected counts and items.
**Deps:** P4-03-01 · **Touches:** bots, domain · **Size:** S

---

## P4-04 · Chat in the app `UI · visual TBD`

### P4-04-01 · Conversation view
**Steps:**
1. Message list with owner and bot bubbles, attachments, pending and failed states.
2. Tool calls and results shown as compact expandable rows.
**Done when:**
- [ ] Manual: chat with a fake-model bot works and survives an app restart.
**Deps:** P4-01-03, P4-02-04 · **Touches:** views · **Size:** M

### P4-04-02 · Bots as contacts list
**Steps:**
1. Sidebar list of the Boss and office bots with last message preview and unread count; selecting opens the conversation.
2. The Boss pinned at the top.
**Done when:**
- [ ] Manual: an incoming bot message raises the unread count live.
**Deps:** P4-04-01 · **Touches:** views, core · **Size:** S

---

## P4-05 · Channel foundation (`packages/channels`)

### P4-05-01 · Channel contract and registry
**What this is:** the `ChannelAdapter` interface (DESIGN §12) and a registry that starts, stops and supervises adapters.
**Steps:**
1. Interface plus `ChannelContext` (`onInbound`, secret store, logger, key-value state for cursors).
2. Registry: start configured adapters at boot, restart on crash with backoff, expose health.
3. Table `channel_state` for cursors and seen ids; dedup by `(channel, externalId)`.
4. A `FakeChannel` adapter for tests.
**Done when:**
- [ ] Test: the fake adapter delivering the same message twice creates one message.
**Deps:** P4-01-01 · **Touches:** channels, db, server · **Size:** M

### P4-05-02 · Owner identity
**What this is:** the configured list of handles that belong to the owner.
**Steps:**
1. Settings: phone numbers (E.164), Apple ID emails, Telegram user ids, WhatsApp numbers.
2. Normalizers per handle type; `isOwner(channel, handle)` used by adapters only.
**Done when:**
- [ ] Tests: `+55 (11) 9…` and `5511 9…` normalize equal; a number with the same last digits is not the owner.
**Deps:** P4-05-01 · **Touches:** channels, server, views · **Size:** S

### P4-05-03 · Inbound routing
**What this is:** where an incoming channel message goes.
**Steps:**
1. Owner messages → the Boss conversation (one conversation across channels, P4-06-01). `@slug text` from the owner → that bot directly.
2. Third-party messages → the conversation of the bot that owns that channel chat (P6), or ignored and logged if none.
3. Every inbound passes the rule tier first (`is_noise`, `is_duplicate`, codes in P4-08).
**Done when:**
- [ ] Tests for each route.
**Deps:** P4-05-02, P3-02-02 · **Touches:** channels, domain · **Size:** M

### P4-05-04 · Outbound policy and delivery
**Steps:**
1. Replies to the owner go out on the channel of the owner's last message unless the Boss names another.
2. Per-channel limits: max message length (long replies cut with "detalhes no card MOT-12"), rate limit, quiet hours (except `now`-level notices the owner allowed).
3. Delivery retries; failures reported in health and as an inbox item after N failures.
**Done when:**
- [ ] Tests: quiet hours hold a `digest` message and let a `now` message through.
**Deps:** P4-05-03 · **Touches:** channels · **Size:** M

### P4-05-05 · Channel settings and health `UI · visual TBD`
**Steps:**
1. Settings page per channel: enable, credentials (secret reference), owner handles, quiet hours, health with the last error.
2. Status indicator in the app's top bar when a channel is down.
**Done when:**
- [ ] Manual: disabling a channel stops it within seconds.
**Deps:** P4-05-04 · **Touches:** views · **Size:** S

---

## P4-06 · The Boss

### P4-06-01 · Boss bot and its single thread
**Steps:**
1. Seed the Boss as a skill folder `bots/boss/`: office bot, `cheap_llm` default tier, frontier allowed for planning-type requests only; its `SKILL.md` says: coordinate, never write code, be brief, use cards for anything that is work.
2. One owner conversation shared by the app and all channels; each message keeps its origin.
**Done when:**
- [ ] Test: messages from the app and from a fake channel land in the same Boss conversation.
**Deps:** P4-03-02, P4-05-03 · **Touches:** bots, domain · **Size:** S

### P4-06-02 · Owner request handling
**What this is:** the Boss turning a request into work.
**Steps:**
1. Decide request kind at the cheapest tier: `status_question`, `new_work`, `follow_up` on a card, `instruction_to_bot`, `chit_chat`.
2. `new_work` → create card(s), assign the right bot, reply with the card numbers.
3. `status_question` → `activity.summary` tool → short answer.
**Done when:**
- [ ] Fixture conversations produce the expected tool calls with a scripted model.
**Deps:** P4-06-01, P4-03-03 · **Touches:** bots · **Size:** M

### P4-06-03 · Report levels and proactive messages
**What this is:** which events the Boss tells the owner about, and when.
**Steps:**
1. Subscribe the Boss to `run.failed`, `card.review_requested`, `budget.exceeded`, `approval.requested`, `engine.limited`, `inbox.changed`.
2. `notify_level` decision (rules first, P3-02-02) → `now` (send), `digest` (store for the next digest, P5-07-01), `silent`.
3. Group bursts: several `now` events within a minute become one message.
**Done when:**
- [ ] Test: a run failure sends one message; ten completions send none.
**Deps:** P4-06-02, P3-02-02 · **Touches:** bots · **Size:** M

### P4-06-04 · Merge requests from chat `Pending owner decision (Q1)`
**Steps:**
1. "merge MOT-12" → the Boss calls the `git.merge` tool → approval with `remote: allowed`, never `always`.
2. The approval message goes out with a code (P4-08-01); only the code reply merges.
**Done when:**
- [ ] Test: a plain "merge" message never merges; the code reply does.
**Deps:** P4-06-02, P2-04-03 · **Touches:** bots, security · **Size:** S

### P4-06-05 · Owner control commands
**Steps:**
1. Rule-tier commands from the owner on any channel: `pausa tudo` (kill switch, P2-06-04), `retoma`, `status`, `pausa <bot>`, `retoma <bot>`.
2. Handled before the Boss model is called; replies are fixed texts in pt-BR.
**Done when:**
- [ ] Test: `pausa tudo` from the owner halts; from a third party it does nothing and is audited.
**Deps:** P4-06-01, P2-06-04 · **Touches:** channels, domain · **Size:** S

---

## P4-07 · iMessage through Plow

### P4-07-01 · Plow API notes and fake server
**What this is:** pinning down the Plow Chat API before coding the adapter.
**Steps:**
1. Read Plow's API docs and the reference usage in `plow/hermes-plugin-plow`; write `packages/channels/plow/API-NOTES.md` (auth with the line token, list chats and messages, cursor semantics, send text and attachments, reactions, attachment download, rate limits).
2. A fake Plow server for tests based on recorded responses.
**Done when:**
- [ ] Notes cover every endpoint the adapter will call; the fake server answers them.
**Deps:** P4-05-01 · **Touches:** channels · **Size:** S

### P4-07-02 · Plow inbound
**Steps:**
1. Poll for new messages every 5 s (configurable) with a persisted cursor; backoff up to 60 s on errors.
2. Normalize to `InboundMessage` with `isOwner` from P4-05-02; download attachments.
3. Tapbacks never start a turn; they are attached as context to the next text (DESIGN §12).
**Done when:**
- [ ] Fake-server tests: receive, restart without reprocessing, outage with backoff, tapback handling.
**Deps:** P4-07-01, P2-05-01 · **Touches:** channels · **Size:** M

### P4-07-03 · Plow outbound and reactions
**Steps:**
1. `send` text and attachments; `react` 👀 on accepted owner messages, ✅ when the Boss's turn ends, ⚠️ on error.
2. Health `ok|degraded|down` with the last error; `down` for 10 minutes opens an inbox item.
**Done when:**
- [ ] Fake-server tests for send, react and health transitions; manual test on the owner's real line.
**Deps:** P4-07-02 · **Touches:** channels · **Size:** S

---

## P4-08 · Approvals and questions by code

### P4-08-01 · Approval codes
**What this is:** answering an approval from the phone with `ok 7F3K`, `não 7F3K` or `sempre 7F3K` (DESIGN §6.4).
**Steps:**
1. When an approval with `remote: allowed` is created and the owner has an active channel, generate a 4-char code (Crockford base32 without `I L O U`), unique among pending approvals and questions, bound to the approval id.
2. Send a pt-BR message with the bot, the action in plain words, the reply options and the expiry.
3. `local_only` approvals send a notice without a code ("Precisa da sua aprovação no Mac.").
**Done when:**
- [ ] Test: codes are unique across pending items; message text matches a snapshot.
**Deps:** P4-07-03, P2-03-02 · **Touches:** channels, security · **Size:** M

### P4-08-02 · Code matching before any model
**Steps:**
1. In the adapter pipeline, before the Boss: strict regex `^\s*(ok|sim|s|yes|y|não|nao|n|no|sempre|always)\s+([0-9A-HJKMNP-TV-Z]{4})\s*$` (case-insensitive).
2. Match + owner + pending + not expired → resolve with `via: channel`, reply "✅ Feito." / "🚫 Negado."; the message never reaches the Boss.
3. Match with any failed condition → "Código inválido ou expirado." + audit.
4. Five invalid attempts in 10 minutes disable channel approvals until re-enabled in the app.
**Done when:**
- [ ] Tests: a valid code from a non-owner is rejected and audited; lockout after five failures.
**Deps:** P4-08-01 · **Touches:** channels, security · **Size:** M

### P4-08-03 · `ask_owner` and answers by code
**What this is:** a bot asking the owner a question and getting the answer back into the right turn.
**Steps:**
1. Tool `ask_owner({ question, options? })` → pending question with a code; the turn waits (durably).
2. Reply `<code> <text>` (or `<code> <n>` for an option) goes verbatim to the waiting turn, marked as the owner's answer; it never grants permissions.
3. In the app, questions show as inbox items with an answer box.
**Done when:**
- [ ] Test: the answer resumes the right turn after a server restart.
**Deps:** P4-08-02, P4-02-04 · **Touches:** bots, channels, domain · **Size:** M

---

## P4-09 · Telegram

### P4-09-01 · Telegram adapter
**Steps:**
1. Bot API with long polling, token from the secret store; owner binding by sending `/start <pairing code>` from the owner's account.
2. Text, photos and documents both ways; reactions where supported.
3. Same pipeline as Plow (dedup, codes, routing).
**Done when:**
- [ ] Fake-API tests; manual test with a real bot.
**Deps:** P4-05-04, P4-08-02 · **Touches:** channels · **Size:** M

### P4-09-02 · Fallback behavior
**Steps:**
1. If the owner's last channel is `down`, `now`-level messages go to the next enabled channel in the owner's preference order.
2. A message telling the owner the primary channel is down.
**Done when:**
- [ ] Test with fake channels: Plow down → the message arrives on Telegram. Gate P4 passes.
**Deps:** P4-09-01, P4-06-03 · **Touches:** channels · **Size:** S
