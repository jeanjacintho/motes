# P2 · Safety base

> Back to [ROADMAP](../ROADMAP.md) · Design refs: DESIGN §10 (security)

**Goal of the phase:** before any bot gets autonomy, every side effect is recorded, every risky action is decided by deterministic code against exact capabilities, secrets never leak into prompts or logs, and spending has hard limits with a stop button.

**Gate P2:** (1) pick ten actions from P1 (move a card, merge, push from a run, revoke a device…) and find each one in the audit viewer; (2) set a Dev bot daily budget of one run, assign two cards, assign a card, and see the bot paused with an inbox item; (3) press the kill switch during a run and see it cancelled and nothing new start.

---

## P2-01 · Audit log (`packages/security`)

### P2-01-01 · Append-only audit table
**What this is:** a table that records who did what, when, through which path, and with which outcome. It can only grow.
**Why:** when bots act alone, the audit log is how the owner reconstructs and trusts what happened.
**Steps:**
1. Table `audit_events` (`seq`, `id`, `at`, `actor` `{ kind, id }`, `action` (e.g. `card.merge`, `run.command`, `device.revoke`), `subject`, `capabilityDigest?`, `decision?` `allowed|denied|approved`, `details` jsonb).
2. A Postgres trigger rejecting `UPDATE` and `DELETE` on the table.
3. No update or delete function exists in code.
**Done when:**
- [ ] Test: `UPDATE audit_events …` fails at the database level.
**Out of scope:** retention or export.
**Deps:** P0-03-02 · **Touches:** security, db · **Size:** S

### P2-01-02 · Audit writer and coverage of existing side effects
**What this is:** a single `audit.record(tx, entry)` function and its use in every P0–P1 operation that changes something outside a card's own fields.
**Steps:**
1. Writer validating entries with a zod schema; called inside the same transaction as the action.
2. Add calls to: pairing and revocation, daemon token minting, bot create/update/delete, card assignment to bots, run cancel, PR merge.
3. A test helper `expectAudited(action)`.
**Done when:**
- [ ] Each listed operation has a test asserting its audit entry.
**Deps:** P2-01-01 · **Touches:** security, domain · **Size:** M

### P2-01-03 · Audit feed from dev runs
**What this is:** copying every command, push and PR creation from dev runs into the audit log.
**Why:** DESIGN §10: unattended CLI runs skip their own prompts, so Motes must at least see everything they ran.
**Steps:**
1. When the server ingests `command` log entries (P1-08-09), write `run.command` audit entries (argv, cwd relative to the worktree, exit code).
2. Daemon push and PR steps (P1-09-01/02) write `run.push` and `run.pr_open`.
**Done when:**
- [ ] Test: a fake run with three commands and a push produces four audit entries in order.
**Deps:** P2-01-02, P1-09-02 · **Touches:** domain, daemon · **Size:** S

### P2-01-04 · Audit viewer `UI · visual TBD`
**Steps:**
1. Page with a reverse-chronological list, filters by actor, action, subject and date; detail drawer showing the JSON.
2. Links from a card or run to its audit entries.
**Done when:**
- [ ] Manual: gate step (1).
**Deps:** P2-01-03 · **Touches:** views, server, core · **Size:** M

---

## P2-02 · Capabilities and rules

### P2-02-01 · Capability schema and normalization
**What this is:** a structured description of what an action will do (e.g. `{ kind: 'channel.send', channel: 'whatsapp', to: '+55…' }`, `{ kind: 'git.merge', repo, pr }`), normalized so equivalent sets look identical.
**Why:** decisions are made on exactly what will happen, never on the goal text a model wrote (DESIGN §10).
**Steps:**
1. Protocol: a discriminated union of capability kinds used by Motes tools (start with `card.write`, `card.assign_bot`, `git.merge`, `channel.send`, `bot.message`, `usage.over_threshold`, `memory.write`, `secret.use`).
2. `normalize(capabilities)`: strip free-text reasons, canonicalize paths and handles, sort, dedupe.
**Done when:**
- [ ] Tests: two sets differing only in order or reason text normalize to the same value.
**Deps:** P0-02-05 · **Touches:** protocol, security · **Size:** M

### P2-02-02 · Rule key
**What this is:** `ruleKey = digest({ botId, capabilities: normalize(set) })`.
**Steps:**
1. Implement using `canonicalJson` + `digest` from P0-02-05.
2. Document in code why goal text is excluded.
**Done when:**
- [ ] Tests: any argument change changes the key; same set for a different bot gives a different key.
**Deps:** P2-02-01 · **Touches:** security · **Size:** S

### P2-02-03 · Rules storage and matching
**What this is:** stored decisions ("always allow this exact set for this bot", "always deny").
**Steps:**
1. Table `rules` (`id`, `ruleKey`, `botId`, `effect` `allow|deny`, `capabilities` (for display), `createdAt`, `revokedAt?`, `source` `owner|approval`).
2. `matchRule(botId, set)` → `allow | deny | none`; deny wins.
3. Routes `GET /rules`, `DELETE /rules/:id` (revoke), with audit.
**Done when:**
- [ ] Tests: a revoked rule no longer matches; deny beats allow.
**Deps:** P2-02-02, P2-01-02 · **Touches:** security, db, server · **Size:** S

### P2-02-04 · Rules manager `UI · visual TBD`
**Steps:**
1. Page listing rules grouped by bot with the readable capability set and a revoke button.
**Done when:**
- [ ] Manual: revoking a rule takes effect on the next action.
**Deps:** P2-02-03 · **Touches:** views · **Size:** S

---

## P2-03 · Approvals

### P2-03-01 · Approval entity and binding
**What this is:** a pending request for the owner to decide one exact action.
**Steps:**
1. Table `approvals` (`id`, `botId`, `ruleKey`, `nonce`, `argsDigest`, `capabilities`, `context` (the bot's explanation, shown but never used for matching), `remote` `allowed|local_only`, `offerAlways`, `state` `pending|allowed|denied|expired`, `expiresAt`, `resolvedBy?`).
2. `requestApproval(...)` creates it, emits `approval.requested`, opens an inbox item (`approval`).
**Done when:**
- [ ] Test: the approval stores the digest of the exact args; changing args after creation does not match it.
**Deps:** P2-02-03, P1-10-03 · **Touches:** security, db, domain · **Size:** M

### P2-03-02 · Resolve and expire
**Steps:**
1. `resolveApproval(id, decision, via)` where decision is `once|always|deny` and via is `app|channel`; single use (row lock + state check).
2. `always` creates a rule (P2-02-03) only if `offerAlways`.
3. Expiry job marks `expired` and emits `approval.expired`; waiting callers receive a denial.
4. Every resolution audited.
**Done when:**
- [ ] Tests: second resolution fails; expired approvals cannot be resolved; `always` without `offerAlways` is refused.
**Deps:** P2-03-01 · **Touches:** security, domain · **Size:** M

### P2-03-03 · Waiting for a decision
**What this is:** how a caller (a tool call in a bot turn) waits for the owner without blocking a thread.
**Steps:**
1. `awaitApproval(id, { timeout })` resolving on `approval.resolved|expired` events.
2. Turns waiting on approval are persisted so a server restart resumes them (used by P4-02-04).
**Done when:**
- [ ] Test: restart while waiting, then resolve → the waiting caller continues.
**Deps:** P2-03-02 · **Touches:** security, domain · **Size:** M

### P2-03-04 · Approval card `UI · visual TBD`
**Steps:**
1. Approval view showing the bot, its explanation (marked "as explained by the bot"), and the exact capabilities in plain words, with allow once / always (if offered) / deny.
2. Desktop notification on new approvals.
**Done when:**
- [ ] Manual: approving in the app unblocks a waiting test tool call.
**Deps:** P2-03-02 · **Touches:** views, desktop · **Size:** M

---

## P2-04 · Tool gateway

### P2-04-01 · Tool registry with capability declarations
**What this is:** every Motes tool (things bots can call: create a card, send a message, merge…) is registered with its input schema and a function that derives its capability set from the input.
**Why:** a tool that cannot say what it will do cannot be gated.
**Steps:**
1. `defineTool({ name, input, capabilities: (input) => Capability[], run })`.
2. Registration fails if `capabilities` is missing.
3. Policy defaults per capability kind (e.g. `card.write` in the bot's own project: allow; `channel.send` to a third party: approval; `git.merge`: approval, `remote` allowed, never `always`).
**Done when:**
- [ ] Test: registering a tool without capabilities throws.
**Deps:** P2-02-01 · **Touches:** security · **Size:** M

### P2-04-02 · Gate pipeline
**What this is:** the single path every tool call goes through.
**Steps:**
1. Validate input → derive capabilities → `matchRule` → if none, policy default → allow, deny, or `requestApproval` and wait → run → audit the outcome.
2. Budget check hook (filled by P2-06-02).
3. Results and errors returned in a uniform shape for bot runtimes.
**Done when:**
- [ ] Tests for each path: rule allow, rule deny, default allow, approval allowed, approval denied, approval expired.
**Deps:** P2-04-01, P2-03-03 · **Touches:** security · **Size:** M

### P2-04-03 · Route owner actions through the gateway
**What this is:** reusing the same gate for risky owner-triggered actions coming from automated paths (e.g. merge requested from chat later).
**Steps:**
1. Wrap merge (P1-09-05) as a tool `git.merge`; the app route calls it with actor `owner` (owner actions from the app are allowed directly but still audited).
2. Document which actions are tools and which are plain owner routes.
**Done when:**
- [ ] Test: a bot calling `git.merge` creates an approval; the owner merging from the app does not.
**Deps:** P2-04-02, P1-09-05 · **Touches:** security, server, domain · **Size:** S

---

## P2-05 · Secrets

### P2-05-01 · Keychain secret store
**What this is:** storing tokens and keys (Plow line token, Telegram bot token, Jev key, WhatsApp session key) in the macOS Keychain, with only a reference in the database.
**Steps:**
1. `SecretStore` interface (`put`, `get`, `delete`, `list`) with a Keychain implementation (service `dev.motes`, account = secret id) and an in-memory one for tests.
2. Table `secret_refs` (`id`, `name`, `kind`, `createdAt`, `lastUsedAt`).
3. Routes to create and delete secrets (value accepted once, never returned).
**Done when:**
- [ ] Test (in-memory): `GET` routes never include values; manual check on macOS with the Keychain.
**Deps:** P0-04-01 · **Touches:** security, server, db · **Size:** M

### P2-05-02 · Redaction everywhere
**What this is:** guaranteeing secret values never appear in logs, events, run logs, audit details or prompts.
**Steps:**
1. A redactor that knows all loaded secret values (and common token patterns) applied to the logger, event payloads, run log ingestion and prompt builder.
2. Bots receive `secret.use` capabilities with references, never values.
**Done when:**
- [ ] Test: after a tool uses a secret, scanning logs, events, run log and audit finds no value.
**Deps:** P2-05-01, P1-08-09 · **Touches:** security, server, domain · **Size:** M

### P2-05-03 · Secrets screen `UI · visual TBD`
**Steps:**
1. Settings page: list secrets by name and kind, add (value field), delete, last used.
**Done when:**
- [ ] Manual: a secret added in the app is visible in Keychain Access under `dev.motes`.
**Deps:** P2-05-01 · **Touches:** views · **Size:** S

---

## P2-06 · Budgets and kill switch

### P2-06-01 · Budget model
**What this is:** limits on how much of the owner's subscriptions each bot may use, per chain of bot work (used in P5), and globally.
**Why:** billing is the owner's own subscriptions (Q2). What runs out is the CLIs' usage windows, and the owner needs capacity left for their own work.
**Steps:**
1. `bot.yaml` `budget`: `runsPerDay?`, `turnsPerDay?`, `minutesPerDay?`, `maxRunMinutes?`, `maxTurnsPerRun?`; global settings with the same fields plus `maxParallelRuns`.
2. Per-engine reserve: "stop bot use of this CLI when the CLI reports less than X% of its window left" for CLIs that report it; otherwise rely on limit messages (P1-10-02).
3. Function `remainingBudget(botId, now)` from usage rollups.
**Done when:**
- [ ] Tests for each unit with a fake clock across midnight; a CLI reporting its window below the reserve is skipped for bots.
**Deps:** P1-10-02, P1-05-01 · **Touches:** protocol, domain · **Size:** M

### P2-06-02 · Enforcement
**Steps:**
1. Check before queuing a run, before a daemon claim, and in the gate pipeline hook (P2-04-02).
2. A run already started that crosses `maxRunMinutes` or `maxTurnsPerRun` is stopped with reason `budget`.
**Done when:**
- [ ] Test: a bot over budget gets no new runs; a run crossing its per-run limit is stopped.
**Deps:** P2-06-01, P2-04-02 · **Touches:** domain, security, daemon · **Size:** M

### P2-06-03 · Breach handling
**Steps:**
1. On breach: pause the bot (`enabled=false`, reason `budget`), emit `budget.exceeded`, open an inbox item, audit.
2. Owner can raise the budget or resume from the inbox item.
**Done when:**
- [ ] Manual: gate step (2).
**Deps:** P2-06-02 · **Touches:** domain, views · **Size:** S

### P2-06-04 · Kill switch
**What this is:** one action that stops everything.
**Steps:**
1. `POST /system/halt`: set global `halted`, cancel all running runs, stop daemons claiming, block the gate pipeline and channel sends; `POST /system/resume` reverses.
2. A visible banner in the app while halted; audit both actions.
3. (Channel command added in P4-06-05.)
**Done when:**
- [ ] Manual: gate step (3).
**Deps:** P2-06-02, P1-08-10 · **Touches:** domain, server, daemon, views · **Size:** M
