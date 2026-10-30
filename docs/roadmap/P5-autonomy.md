# P5 · Autonomous team

> Back to [ROADMAP](../ROADMAP.md) · Design refs: DESIGN §9 (autonomy), §5 principles 2 and 3

**Goal of the phase:** bots act on their own. They wake on events, schedules and webhooks, hand work to each other, remember what matters, reuse playbooks, and the Boss keeps the owner informed with digests, all without the owner wiring a flow for each case.

**Gate P5:** for one full working day, the owner gives orders only through the Boss on the phone. At least one chain (office bot → card → dev run → review → Boss report) completes with no owner action except the final review. Review the day's cost per tier in the cost view.

---

## P5-01 · Triggers

### P5-01-01 · Trigger entity
**What this is:** a subscription that wakes a bot: an event type with a filter, a cron schedule, or a webhook.
**Steps:**
1. Protocol: `triggerSchema` (`id`, `botId`, `kind` `event|cron|webhook`, `eventType?`, `filter?` (project, labels, status, channel, trust), `cron?`, `timezone`, `enabled`, `instruction` (text given to the bot when it fires)).
2. Table `triggers`; service create, update, enable, delete; audit.
3. Triggers can also be declared in the bot spec and synced on save.
**Done when:**
- [ ] Schema tests; a filter on labels matches only cards with all listed labels.
**Deps:** P4-02-03 · **Touches:** protocol, db, domain · **Size:** M

### P5-01-02 · Event matcher
**What this is:** the worker that reads the event outbox and turns matching events into bot work.
**Steps:**
1. A consumer with its own persisted cursor over `events` (P0-03-04), woken by `NOTIFY`.
2. For each event, find enabled event-triggers whose filter matches.
3. Run the rule tier first (P3-02); only events the rules do not drop are enqueued in the bot's turn queue (office) or as a run (dev).
4. Loop guard: events caused by a bot's own action never trigger that same bot.
**Done when:**
- [ ] Test: an event matching no rule produces no model call; a bot never wakes itself.
**Deps:** P5-01-01, P3-02-02 · **Touches:** domain, bots · **Size:** M

### P5-01-03 · Trigger editor `UI · visual TBD`
**Steps:**
1. On the bot page: list triggers, create with an event type picker and filter fields, cron with a human-readable preview, enable toggle, last fired time.
**Done when:**
- [ ] Manual: a trigger on `card.labels_changed` with label `bug` wakes the chosen bot.
**Deps:** P5-01-02 · **Touches:** views · **Size:** M

---

## P5-02 · Scheduler

### P5-02-01 · Job table and worker
**What this is:** persistent scheduled jobs in Postgres.
**Steps:**
1. Table `jobs` (`id`, `kind`, `runAt`, `payload`, `state`, `attempts`, `lockedUntil`).
2. Worker claiming due jobs with `SKIP LOCKED`; jobs due during downtime run once after restart.
3. Move existing periodic work (runtime offline check, approval expiry, PR sync) onto it.
**Done when:**
- [ ] Test with a fake clock: a job due while the server was down runs exactly once.
**Deps:** P0-03-02 · **Touches:** domain, db, server · **Size:** M

### P5-02-02 · Cron triggers
**Steps:**
1. Each enabled cron trigger keeps its next fire time as a job; firing enqueues the bot with the trigger's instruction and reschedules.
2. Timezone-aware (owner's timezone by default).
**Done when:**
- [ ] Test: a daily trigger at 09:00 fires once per day across a DST change.
**Deps:** P5-02-01, P5-01-01 · **Touches:** domain · **Size:** S

### P5-02-03 · Deferred runs and wakeups
**What this is:** a bot asking to be woken later ("check the CI in 20 minutes", "follow up with the customer tomorrow").
**Steps:**
1. Tool `wakeup.schedule({ at | in, reason, subject })` → job; run state `deferred` for dev runs.
2. Wakeups are listed on the card or conversation and can be cancelled.
**Done when:**
- [ ] Test: a scheduled wakeup enqueues the bot at the right time with its reason.
**Deps:** P5-02-01 · **Touches:** bots, domain · **Size:** S

---

## P5-03 · Webhooks

### P5-03-01 · Signed webhook endpoint
**Steps:**
1. `POST /hooks/:triggerId` (no device token) verified with HMAC-SHA256 over the raw body using a per-trigger secret; timestamp header with a 5-minute window; replayed ids rejected.
2. The payload is third-party data: delivered to the bot as a data block, never as instructions.
**Done when:**
- [ ] Tests: unsigned, wrongly signed, stale and replayed requests are rejected; a valid one enqueues the bot.
**Deps:** P5-01-01, P2-05-01 · **Touches:** server, domain · **Size:** M

### P5-03-02 · GitHub webhook for PR events
**What this is:** replacing PR polling (P1-09-04) with GitHub webhooks when the hub is reachable.
**Steps:**
1. Handle `pull_request` (merged, closed) and `pull_request_review` / `issue_comment` events with GitHub's signature scheme.
2. Keep polling as a fallback when no webhook has arrived for a configured time.
**Done when:**
- [ ] Recorded webhook fixtures move cards like the polling path does.
**Deps:** P5-03-01, P1-09-04 · **Touches:** server, domain · **Size:** M

---

## P5-04 · Handoffs and bot-to-bot work

### P5-04-01 · Handoff entity and tool
**What this is:** a structured "please take this" from one bot to another.
**Steps:**
1. Protocol and table `handoffs` (`id`, `fromBotId`, `toBotId`, `reason`, `context`, `subject` (card or conversation), `chainId`, `hop`, `state` `pending|accepted|declined|done`).
2. Tool `handoff.create`; the target bot gets it in its queue; `handoff.accept|decline` tools.
3. Events `handoff.*`; activity entries on the card (P1-03-02).
**Done when:**
- [ ] Test: a handoff appears in the target's queue and on the card timeline.
**Deps:** P4-02-03, P1-03-02 · **Touches:** protocol, db, domain, bots · **Size:** M

### P5-04-02 · Bot messages
**Steps:**
1. Tool `bot.message({ to, text, subject? })` writing into a `bot_bot` conversation with trust `bot`.
2. Capability `bot.message` (default allow among bots on the same project).
**Done when:**
- [ ] Test: a bot message wakes the target bot once.
**Deps:** P5-04-01 · **Touches:** bots, domain · **Size:** S

### P5-04-03 · Chains, hop limit and chain budget
**What this is:** protection against bots bouncing work forever.
**Steps:**
1. Every handoff and bot message carries a `chainId` inherited from what started it; `hop` increments.
2. Max hops per chain (default 6) and a chain budget (P2-06-01); exceeding either stops the chain and opens an inbox item.
**Done when:**
- [ ] Test: a ping-pong between two bots stops at the hop limit with one inbox item.
**Deps:** P5-04-02, P2-06-02 · **Touches:** domain, bots · **Size:** M

### P5-04-04 · Office to dev chaining
**Steps:**
1. An office bot creating a card and assigning a dev bot (P4-03-02) passes its `chainId` to the run; the run's completion event carries it back.
2. The office bot that started the chain can subscribe to its completion (e.g. Support telling the customer).
**Done when:**
- [ ] Test: a fake Triage bot's card triggers a fake dev run whose completion wakes Triage.
**Deps:** P5-04-03, P1-08-03 · **Touches:** bots, domain · **Size:** M

### P5-04-05 · Chains in the UI `UI · visual TBD`
**Steps:**
1. On a card: a "chain" panel showing which bots touched it, in order, with handoff reasons.
2. A chain view listing all steps across cards and conversations.
**Done when:**
- [ ] Manual: the gate chain is fully visible from the final card.
**Deps:** P5-04-04 · **Touches:** views · **Size:** M

---

## P5-05 · Memory

### P5-05-01 · Memory facts with provenance
**What this is:** what a bot knows across conversations (owner preferences, project facts, customer facts).
**Steps:**
1. Table `memory_facts` (`id`, `botId` or `shared`, `category`, `text`, `source` (message, card, run), `state` `proposed|active|rejected|retired`, `createdAt`).
2. Categories with a risk level (e.g. `preference` low, `customer_fact` medium, `instruction` high).
**Done when:**
- [ ] Schema and repository tests.
**Deps:** P4-02-01 · **Touches:** protocol, db, bots · **Size:** S

### P5-05-02 · Proposals and review
**Steps:**
1. Tool `memory.propose({ category, text, source })`.
2. Low-risk categories auto-accept; others create an inbox item for the owner to accept or reject.
3. `instruction`-category facts can never be proposed from a turn that contained third-party text (they would let a stranger change a bot's behavior).
**Done when:**
- [ ] Tests: a rejected proposal never appears in a prompt; an instruction proposal from a customer conversation is refused.
**Deps:** P5-05-01, P1-10-03 · **Touches:** bots, security · **Size:** M

### P5-05-03 · Recall in prompts
**Steps:**
1. Lexical ranking of active facts against the current input (start simple; embeddings later), capped to a token budget.
2. Prompt builder section (P4-02-01) listing recalled facts with their ids.
**Done when:**
- [ ] Test: the most relevant facts are included within the budget.
**Deps:** P5-05-02, P4-02-01 · **Touches:** bots · **Size:** M

### P5-05-04 · Memory screen `UI · visual TBD`
**Steps:**
1. Per bot: list facts by state and category, edit, retire, see the source.
**Done when:**
- [ ] Manual: retiring a fact removes it from the next turn's prompt.
**Deps:** P5-05-03 · **Touches:** views · **Size:** S

---

## P5-06 · Skills

### P5-06-01 · Skill entity
**What this is:** a reusable playbook (markdown plus optional files), like "how we release", "how to reproduce a customer bug".
**Steps:**
1. Tables `skills` (`id`, `slug`, `name`, `description`, `body`) and `skill_files`; import and export as a folder with `SKILL.md`.
**Done when:**
- [ ] Round-trip test for import and export.
**Deps:** P1-05-02 · **Touches:** protocol, db, domain · **Size:** S

### P5-06-02 · Attach and inject
**Steps:**
1. Attach skills to bots (`bot_skills`).
2. Office bots: skill descriptions in the prompt, full body loaded on demand with a `skill.read` tool.
3. Dev runs: skill folders written into the worktree under `.motes/skills/` and referenced in `.motes/context.md`.
**Done when:**
- [ ] Test: a dev run's worktree contains the attached skill files; an office prompt lists skill descriptions only.
**Deps:** P5-06-01, P1-07-06, P4-02-01 · **Touches:** domain, daemon, bots · **Size:** M

### P5-06-03 · Skills screen `UI · visual TBD`
**Steps:**
1. List, create, edit (markdown), attach to bots, import/export.
**Done when:**
- [ ] Manual: editing a skill changes the next run's files.
**Deps:** P5-06-02 · **Touches:** views · **Size:** S

---

## P5-07 · Digests

### P5-07-01 · Digest builder
**What this is:** the Boss's periodic summary for the owner.
**Steps:**
1. Collect `digest`-level items since the last digest (P4-06-03) and the activity summary (P4-03-03).
2. Code builds the structure (per project: done, in review, blocked, failed, cost); the cheap tier only writes the short pt-BR text around it.
**Done when:**
- [ ] Test: a fixture day produces a digest whose numbers match the events.
**Deps:** P4-06-03, P4-03-03 · **Touches:** bots · **Size:** M

### P5-07-02 · Digest schedule and delivery
**Steps:**
1. Owner settings: digest times (e.g. 12:00 and 18:00), skip when empty, channel.
2. Cron job (P5-02-02) sends through the outbound policy (P4-05-04).
**Done when:**
- [ ] Gate P5 passes.
**Deps:** P5-07-01, P5-02-02 · **Touches:** bots, channels · **Size:** S
