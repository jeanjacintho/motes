# P1 · Pipeline

> Back to [ROADMAP](../ROADMAP.md) · Design refs: DESIGN §6.1 (processes), §6.2 (dev bots), §6.3 (core domain), §10 (dev runs)

**Goal of the phase:** the board pipeline works for dev work. The owner creates a card, assigns it to a Dev bot, a daemon on the Mac mini runs one of the owner's CLIs (Claude Code, Codex, OpenCode, Cursor) in an isolated worktree, the log streams live, and the result arrives as a PR with the card in review.

**Gate P1:** on the Mac mini, with a real repository: create a card "fix typo in README", assign it to the Dev bot, watch the run log live in the app, and get a PR link on the card with status `in_review` and its usage shown. Repeat with Codex, OpenCode and the Cursor CLI.

---

## P1-01 · Projects

### P1-01-01 · Project entity
**What this is:** a project groups cards and holds the context bots need (name, description, key, default runtime).
**Why:** cards need a home and a short key for human-readable numbers (`MOT-12`).
**Steps:**
1. Protocol: `projectSchema` (`id`, `key` 2–6 uppercase letters, `name`, `description`, `defaultRuntimeId?`, `archivedAt?`).
2. Table `projects` + migration; unique `key`.
3. Domain service: `createProject`, `renameProject`, `archiveProject`, `listProjects({ includeArchived })`, each emitting `project.*` events.
**Done when:**
- [ ] Tests: duplicate key → `Conflict`; archived projects hidden by default; events emitted in the same transaction.
**Out of scope:** repositories (next card), routes (P1-01-03).
**Deps:** P0-04-03, P0-03-04 · **Touches:** protocol, db, domain · **Size:** S

### P1-01-02 · Project repositories
**What this is:** the git repositories attached to a project, with the local path on each machine.
**Why:** a dev run needs to know which repo to check out and where it lives on the runtime that claims it.
**Steps:**
1. Protocol: `repositorySchema` (`id`, `projectId`, `name`, `remoteUrl`, `defaultBranch`, `isPrimary`).
2. Table `repository_paths` (`repositoryId`, `runtimeId`, `localPath`), filled by the daemon or the owner.
3. Service: add, update, remove repository; set primary (exactly one per project); set local path per runtime.
**Done when:**
- [ ] Tests: setting a new primary unsets the old one atomically; removing a repo used by open cards → `Conflict`.
**Out of scope:** cloning repos automatically.
**Deps:** P1-01-01 · **Touches:** protocol, db, domain · **Size:** S

### P1-01-03 · Project routes
**What this is:** HTTP routes for projects and repositories.
**Steps:**
1. `GET/POST /projects`, `PATCH /projects/:id`, `POST /projects/:id/archive`.
2. `GET/POST /projects/:id/repositories`, `PATCH/DELETE /repositories/:id`, `PUT /repositories/:id/paths/:runtimeId`.
3. API client methods in `core` with Query keys `['projects']`, `['projects', id, 'repositories']` and event invalidations.
**Done when:**
- [ ] Route tests for success and each error code; core tests for invalidation on `project.*` events.
**Deps:** P1-01-02 · **Touches:** server, core · **Size:** S

### P1-01-04 · Project screens `UI · visual TBD`
**What this is:** list, create and edit projects and their repositories.
**Steps:**
1. Sidebar section listing projects; "new project" dialog.
2. Project settings page: name, key, description, repositories table with local paths per runtime.
**Done when:**
- [ ] Manual: create a project with a repo and see it appear live in a second window.
**Deps:** P1-01-03, P0-06-03 · **Touches:** views, desktop · **Size:** M

---

## P1-02 · Cards

### P1-02-01 · Card entity and numbering
**What this is:** the unit of work. Each card has a per-project number (`MOT-12`).
**Why:** everything in the pipeline (runs, comments, PRs, handoffs) hangs off a card.
**Steps:**
1. Protocol: `cardSchema` (`id`, `projectId`, `number`, `title`, `description` markdown, `status`, `priority` `none|low|medium|high|urgent`, `assignee?` `{ type: 'owner' | 'bot', id }`, `repositoryId?`, `labels`, `createdBy`, timestamps).
2. Table `cards`; per-project counter (`project_counters` row locked `FOR UPDATE` when allocating).
3. Repository functions to insert and fetch by id or by `KEY-number`.
**Done when:**
- [ ] Test: 20 concurrent inserts in one project get numbers 1–20 with no gaps or duplicates.
**Deps:** P1-01-01 · **Touches:** protocol, db · **Size:** M

### P1-02-02 · Card service and events
**What this is:** the domain operations on cards.
**Steps:**
1. `createCard`, `updateCard` (title, description, priority, repository), `assignCard`, `deleteCard` (soft delete).
2. Events: `card.created`, `card.updated` (with changed fields), `card.assigned`, `card.deleted`.
3. Validate `repositoryId` belongs to the card's project; default to the primary repo.
**Done when:**
- [ ] Tests: each mutation emits exactly one event in the same transaction; assignment to an unknown bot → `NotFound`.
**Deps:** P1-02-01 · **Touches:** domain · **Size:** S

### P1-02-03 · Status workflow
**What this is:** the allowed status transitions (`backlog → todo → in_progress → in_review → done`, plus `blocked`, `cancelled`).
**Why:** bots and automations rely on statuses meaning the same thing every time.
**Steps:**
1. A transition table in `domain` (e.g. `done` can reopen to `todo`; `cancelled` only from non-done states).
2. `changeStatus(cardId, to, actor, reason?)` emitting `card.status_changed` with `from` and `to`.
3. Some transitions are reserved to the system (e.g. `in_progress` when a run starts, `in_review` when a PR opens) but the owner can always override.
**Done when:**
- [ ] Table-driven tests for every allowed and forbidden transition.
**Deps:** P1-02-02 · **Touches:** domain · **Size:** S

### P1-02-04 · Labels
**What this is:** per-project labels (name, color) attachable to cards.
**Why:** triggers (P5) and filters use labels like `bug`, `customer`, `urgent`.
**Steps:**
1. Tables `labels` and `card_labels`; service to create, rename, delete (removing from cards in the same transaction), attach, detach.
2. Events `card.labels_changed`.
**Done when:**
- [ ] Test: deleting a label removes it from all cards atomically.
**Deps:** P1-02-02 · **Touches:** protocol, db, domain · **Size:** S

### P1-02-05 · Ordering and board query
**What this is:** the position of each card within its status column and the query that returns a whole board.
**Steps:**
1. Fractional index column `position` (string keys) so moving a card updates only that card.
2. `moveCard(cardId, toStatus, beforeId?, afterId?)` = status change (P1-02-03) + new position.
3. `getBoard(projectId, filters)` grouped by status; filters: assignee, label, priority, text search on title.
**Done when:**
- [ ] Test: 50 random moves keep positions unique and ordered; filters combine correctly.
**Deps:** P1-02-03, P1-02-04 · **Touches:** db, domain · **Size:** M

### P1-02-06 · Card routes and client hooks
**What this is:** HTTP routes and `core` hooks for cards.
**Steps:**
1. `POST /projects/:id/cards`, `GET /cards/:ref` (id or `KEY-n`), `PATCH /cards/:id`, `POST /cards/:id/move`, `POST /cards/:id/assign`, `GET /projects/:id/board`.
2. `core`: `useBoard(projectId, filters)`, `useCard(ref)`, mutations with optimistic move (snapshot + rollback per DESIGN §8 rules) and invalidation on `card.*` events.
**Done when:**
- [ ] Route tests; a core test showing rollback when a move fails.
**Deps:** P1-02-05 · **Touches:** server, core · **Size:** M

---

## P1-03 · Timeline

### P1-03-01 · Comments
**What this is:** markdown comments on a card written by the owner or by bots.
**Steps:**
1. Table `comments` (`id`, `cardId`, `author` `{ type, id }`, `body`, `editedAt?`, `deletedAt?`).
2. Service: add, edit (author only), soft delete; events `comment.created|updated|deleted`.
**Done when:**
- [ ] Tests: a bot cannot edit the owner's comment.
**Deps:** P1-02-02 · **Touches:** protocol, db, domain · **Size:** S

### P1-03-02 · Activity entries
**What this is:** system lines in the card timeline ("moved to In review", "assigned to Dev", "run #3 failed").
**Why:** the owner (and the Boss) can reconstruct what happened without reading logs.
**Steps:**
1. Table `card_activity` written by a projector that listens to `card.*`, `run.*` and (later) `handoff.*` events.
2. Each activity row stores a type and a small payload; rendering text lives in `views`.
**Done when:**
- [ ] Test: replaying a sequence of events produces the expected activity rows; replay is idempotent.
**Deps:** P1-03-01 · **Touches:** domain, db · **Size:** M

### P1-03-03 · Mentions
**What this is:** `@bot-slug` in a comment.
**Why:** mentioning a bot is one of the triggers that queues a run (P1-08-03).
**Steps:**
1. Parse mentions from comment markdown (ignore code blocks and quotes).
2. Store `comment_mentions`; emit `comment.mentioned` per mentioned bot.
**Done when:**
- [ ] Tests: mentions inside code spans are ignored; unknown slugs are ignored.
**Deps:** P1-03-01, P1-05-02 · **Touches:** domain · **Size:** S

### P1-03-04 · Timeline route
**What this is:** one paginated stream of comments and activity for a card.
**Steps:**
1. `GET /cards/:id/timeline?cursor=` merging both sources by time.
2. `POST /cards/:id/comments`, `PATCH/DELETE /comments/:id`.
3. `core`: `useTimeline(cardId)` with live append on events.
**Done when:**
- [ ] Route test with interleaved comments and activity in order.
**Deps:** P1-03-02, P1-03-03 · **Touches:** server, core · **Size:** S

---

## P1-04 · Board UI `UI · visual TBD`

### P1-04-01 · Board columns
**What this is:** the board screen with one column per status.
**Steps:**
1. `BoardScreen` in `views` using `useBoard`; card tiles with number, title, assignee avatar, labels, priority.
2. Empty and loading states; long titles truncate.
**Done when:**
- [ ] Component test renders a fixture board.
**Deps:** P1-02-06, P1-01-04 · **Touches:** views · **Size:** M

### P1-04-02 · Drag and drop
**What this is:** moving cards between and within columns.
**Steps:**
1. Drag library (builder's choice) with keyboard support.
2. Optimistic move through the mutation from P1-02-06; rollback toast on failure.
**Done when:**
- [ ] Manual: drag in one window updates the other live; keyboard move works.
**Deps:** P1-04-01 · **Touches:** views · **Size:** M

### P1-04-03 · Card detail
**What this is:** the card page or side panel: title, description editor, status, assignee, priority, labels, repo, timeline, comment box.
**Steps:**
1. Inline editing for each field; markdown editor for description and comments.
2. Timeline from P1-03-04.
**Done when:**
- [ ] Manual: every field edits and syncs live.
**Deps:** P1-04-01, P1-03-04 · **Touches:** views · **Size:** M

### P1-04-04 · Create card and filters
**What this is:** quick card creation and the filter bar.
**Steps:**
1. "New card" dialog (title required, rest optional), keyboard shortcut.
2. Filter bar: assignee, label, priority, search; filters kept in a Zustand store in `core` (client state).
**Done when:**
- [ ] Filters persist across app restarts (durable preference) and do not store server data.
**Deps:** P1-04-01 · **Touches:** views, core · **Size:** S

---

## P1-05 · Bots

### P1-05-01 · Bot folder format
**What this is:** the definition of a bot as a skill folder (DESIGN §6.2): `SKILL.md` holds the behavior, `bot.yaml` holds the Motes configuration.
**Why:** the owner decided that a bot's behavior is defined by its skill file. Keeping `SKILL.md` in the standard format means every supported CLI can load it as is.
**Steps:**
1. Protocol: `skillFrontMatterSchema` (`name`, `description`, standard fields only) and a parser for `SKILL.md` (front matter + markdown body).
2. Protocol: `botConfigSchema` for `bot.yaml` (`slug` (= folder name), `displayName`, `avatar`, `kind` `dev|office`, `engines` (`claude|codex|opencode|cursor`, in preference order), `models` per tier, `effort?`, `limits` (max turns, max run minutes, max parallel runs), `skills` (attached shared skills), `enabled`; budget, triggers and tools are added by later cards).
3. `loadBotFolder(path)` returns `{ config, skill, references }` with field-level validation errors pointing to the file.
**Done when:**
- [ ] Tests: a valid folder loads; a missing `SKILL.md`, a non-standard field in the skill front matter, or an unknown engine fails with a readable error.
**Out of scope:** storage and watching (next card).
**Deps:** P0-02-02 · **Touches:** protocol · **Size:** M

### P1-05-02 · Skills directory and bot index
**What this is:** the folder on the hub where all bot and shared skills live, and the database index the rest of the system queries.
**Why:** the files are the source of truth, but cards, runs and the UI need fast lookups by id.
**Steps:**
1. Directory `~/Motes/skills/` with `bots/<slug>/` and `shared/<slug>/`; initialized as a git repository on first start.
2. A watcher that loads changed folders (P1-05-01), validates them, and upserts the index table `bots` (`id`, `slug`, `kind`, `engines`, `enabled`, `skillDigest`, `loadError?`); the behavior text itself stays in the file.
3. A folder with errors keeps its last valid version active and shows `loadError` in the app.
4. Routes `GET /bots`, `GET /bots/:id` (config + skill content read from disk); events `bot.*`.
**Done when:**
- [ ] Tests (temp dir): adding, editing and deleting a folder updates the index and emits events; an invalid edit keeps the previous version and reports the error.
**Deps:** P1-05-01, P0-03-04 · **Touches:** domain, db, server, core · **Size:** M

### P1-05-03 · Editing bots through their files
**What this is:** the server API that changes a bot by writing its files and committing them.
**Why:** every behavior change has a history and can be reverted.
**Steps:**
1. Routes `PUT /bots/:id/skill` (new `SKILL.md`), `PATCH /bots/:id/config` (fields of `bot.yaml`), `POST /bots` (new folder from a template), `DELETE /bots/:id` (refused while it has running runs).
2. Each write validates first, writes atomically, and commits to the skills repo with a message like `bot(support): update behavior`.
3. `GET /bots/:id/history` and `POST /bots/:id/revert/:commit`.
4. Audit entries for each change (wired in P2-01-02).
**Done when:**
- [ ] Tests: an invalid write changes nothing on disk; a revert restores the previous behavior.
**Deps:** P1-05-02 · **Touches:** server, domain · **Size:** M

### P1-05-04 · Default Dev bot
**What this is:** a seeded Dev bot so the pipeline works on day one.
**Steps:**
1. On first start, create `bots/dev/` with a `SKILL.md` describing how to work on a card (read `.motes/context.md`, work only in the worktree, run the project's tests, finish with a summary) and a `bot.yaml` with kind `dev` and engines `[claude, codex]`.
2. Seeding is idempotent and never overwrites an existing folder.
**Done when:**
- [ ] A fresh install has the Dev bot; editing its skill survives a restart.
**Deps:** P1-05-03 · **Touches:** domain · **Size:** S

### P1-05-05 · Bot list and skill editor `UI · visual TBD`
**Steps:**
1. Bots page: list with status (enabled, running, idle, load error), create from template, enable toggle.
2. Bot page: a markdown editor for `SKILL.md`, a form for `bot.yaml` fields, the change history with revert.
**Done when:**
- [ ] Manual: editing the Dev bot's skill in the app changes the file on disk and creates a commit; the next run uses it.
**Deps:** P1-05-03, P0-06-03 · **Touches:** views · **Size:** M

---

## P1-06 · Runtimes

### P1-06-01 · Daemon tokens
**What this is:** a separate kind of device token for daemons, minted from the app.
**Why:** a daemon must authenticate, but with fewer rights than a client.
**Steps:**
1. `POST /runtimes/tokens` (owner only) returns a one-time token of kind `daemon`.
2. Route guard: daemon tokens can only reach `/daemon/*` routes.
**Done when:**
- [ ] Test: a daemon token gets 403 on `/cards`.
**Deps:** P0-04-05 · **Touches:** server, domain · **Size:** S

### P1-06-02 · Runtime registration
**What this is:** a machine announcing itself and its engines.
**Steps:**
1. Protocol: `runtimeSchema` (`id`, `machineName`, `os`, `engines` [{ `name`, `version`, `path` }], `capacity` max parallel runs, `lastHeartbeatAt`).
2. `POST /daemon/register` (idempotent per token) and table `runtimes`.
**Done when:**
- [ ] Test: re-registering updates engines without creating a second runtime.
**Deps:** P1-06-01 · **Touches:** protocol, db, domain, server · **Size:** S

### P1-06-03 · Heartbeat and online status
**What this is:** the signal that a runtime is alive.
**Steps:**
1. `POST /daemon/heartbeat` with current load.
2. A server job marks runtimes offline after 3 missed beats (default 15 s interval) and emits `runtime.online|offline`.
**Done when:**
- [ ] Test with a fake clock: missed beats flip status and emit one event per change.
**Deps:** P1-06-02 · **Touches:** domain, server · **Size:** S

### P1-06-04 · Runtimes screen `UI · visual TBD`
**Steps:**
1. List machines with status, engines, versions, current runs.
2. "Add machine" flow showing the daemon install command with a fresh token.
**Done when:**
- [ ] Manual: a daemon going offline turns grey within the timeout.
**Deps:** P1-06-03 · **Touches:** views · **Size:** S

---

## P1-07 · Daemon (`apps/daemon`)

### P1-07-01 · Daemon process and login
**What this is:** the CLI process that runs on each machine.
**Steps:**
1. `motes-daemon login --server <url> --token <t>` stores the token in the machine's Keychain and the server URL in `~/.motes/daemon.json`.
2. `motes-daemon start` (foreground) with structured logs to `~/.motes/logs/`.
3. `motes-daemon status`.
**Done when:**
- [ ] Manual: login then start connects and registers (uses P1-06-02).
**Deps:** P1-06-02 · **Touches:** daemon · **Size:** M

### P1-07-02 · Heartbeat loop and reconnect
**Steps:**
1. Heartbeat every 15 s; exponential backoff on server errors; resume when the server returns.
2. Daemon WebSocket to receive "work available" nudges (fallback: claim poll every 10 s).
**Done when:**
- [ ] Test: server restart → daemon reconnects without manual action.
**Deps:** P1-07-01, P1-06-03 · **Touches:** daemon · **Size:** S

### P1-07-03 · Engine discovery
**What this is:** finding which agent CLIs are installed and logged in.
**Steps:**
1. Look up the supported CLIs on PATH (`claude`, `codex`, `opencode`, `cursor-agent`, plus configured extra paths); read versions and whether each one is logged in (the owner's subscription), without making a model call.
2. Report them in register and on change; a CLI that is installed but logged out is shown as such.
3. Tests use fake executables only (never real CLIs, per AGENTS.md).
**Done when:**
- [ ] Test with fake binaries: versions detected; a missing binary is reported as absent.
**Deps:** P1-07-01 · **Touches:** daemon · **Size:** S

### P1-07-04 · Run at login (LaunchAgent)
**Steps:**
1. `motes-daemon install` writes `~/Library/LaunchAgents/dev.motes.daemon.plist` and loads it; `uninstall` reverses it.
2. Same mechanism and a `motes-server install` for the server on the hub.
**Done when:**
- [ ] Manual: after reboot, both processes are running.
**Deps:** P1-07-01 · **Touches:** daemon, server · **Size:** S

### P1-07-05 · Claim loop
**What this is:** the daemon asking for work it can do.
**Steps:**
1. `POST /daemon/claim` with free capacity and available engines; returns zero or more runs with their context snapshot.
2. Respect capacity; mark runs `dispatched` on claim.
**Done when:**
- [ ] Test with the server: a daemon with capacity 1 never holds two running runs.
**Deps:** P1-07-02, P1-08-02 · **Touches:** daemon · **Size:** S

### P1-07-06 · Worktree preparation
**What this is:** an isolated copy of the repo for each run.
**Steps:**
1. Resolve the repo's local path for this runtime (P1-01-02); fail the run with a clear reason if missing.
2. `git fetch`, then `git worktree add ~/.motes/worktrees/<run-id> -b motes/<card-key>-<n>-<run-short> origin/<defaultBranch>`.
3. Write `.motes/context.md` in the worktree with the card and timeline summary (from the snapshot).
4. Install the bot's own skill (its behavior, P1-05-01) and its attached skills where the engine loads skills natively (e.g. `.claude/skills/` for Claude Code, the equivalent folder for the other CLIs), excluded from commits through `.git/info/exclude`.
**Done when:**
- [ ] Test against a temp git repo: the worktree exists on a new branch from the default branch.
**Deps:** P1-07-05 · **Touches:** daemon · **Size:** M

### P1-07-07 · Directory lock and cleanup
**What this is:** making sure two runs never fight over the same worktree, and old worktrees are removed.
**Steps:**
1. Lock file per repo for operations that touch the main checkout (fetch, worktree add/remove); run state `waiting_directory` while waiting.
2. After a run ends, remove the worktree unless kept for review (keep until the PR is merged or closed).
3. GC on start: remove worktrees of runs the server reports as finished.
**Done when:**
- [ ] Test: two concurrent prepares on one repo serialize; a crashed run's worktree is collected on restart.
**Deps:** P1-07-06 · **Touches:** daemon · **Size:** M

### P1-07-08 · Minimal engine environment
**What this is:** the environment variables and files an engine process gets.
**Why:** DESIGN §10: dev runs only see what the project needs, never Motes' own tokens.
**Steps:**
1. Build env from an allowlist (`PATH`, `HOME`, `LANG`, project-specific vars) and drop everything else.
2. Never pass the daemon token; never mount `~/.motes`.
**Done when:**
- [ ] Test: the fake engine's recorded env has no `MOTES_*` token and no unexpected variables.
**Deps:** P1-07-06 · **Touches:** daemon · **Size:** S

---

## P1-08 · Runs and engines

### P1-08-01 · Run entity and state machine
**What this is:** one execution of a bot against a card (DESIGN §6.3).
**Steps:**
1. Protocol: `runSchema` (`id`, `cardId?`, `conversationId?`, `botId`, `runtimeId?`, `trigger` (`assignment|mention|chat|retry|manual|wakeup`), `state`, `attempt`, `failureReason?`, timestamps, `usage`).
2. Table `runs`; transitions `deferred → queued → dispatched → (waiting_directory) → running → completed|failed|cancelled`.
3. Events `run.queued|started|completed|failed|cancelled`; card goes `in_progress` when a run starts (system transition).
**Done when:**
- [ ] Table-driven tests for transitions; illegal ones throw `Conflict`.
**Deps:** P1-02-03, P1-05-02 · **Touches:** protocol, db, domain · **Size:** M

### P1-08-02 · Queue claim
**What this is:** the server side of handing runs to daemons safely.
**Steps:**
1. Claim query with `FOR UPDATE SKIP LOCKED`, filtered by engine availability and the card's repository having a local path on that runtime.
2. A run whose runtime goes offline mid-run is marked failed with reason `runtime_lost` after a grace period.
**Done when:**
- [ ] Test: two claimers in parallel never get the same run.
**Deps:** P1-08-01, P1-06-03 · **Touches:** domain, db, server · **Size:** M

### P1-08-03 · Run triggers
**What this is:** what creates a run.
**Steps:**
1. Assigning a card to an enabled dev bot → one run (`assignment`).
2. `comment.mentioned` for a dev bot → one run with the comment as instruction (`mention`).
3. "Run again" button → `manual`.
4. Context snapshot stored on the run: card fields, last N timeline items, the bot's skill digest, repository.
5. Never two active runs of the same bot on the same card; a new trigger while one runs becomes a steering message (P1-08-11).
**Done when:**
- [ ] Tests: each trigger creates exactly one run; a disabled bot creates none.
**Deps:** P1-08-02, P1-03-03 · **Touches:** domain · **Size:** M

### P1-08-04 · Engine driver contract and fake engine
**What this is:** the interface every agent CLI driver implements in `packages/engines`.
**Steps:**
1. `EngineDriver`: `start({ cwd, prompt, env, model, effort, skillsDir }) → EngineRun` with `events` (async iterable of normalized log entries), `send(message)`, `stop()`, `result` (summary, usage).
2. Normalized log entry types: `message`, `tool_call`, `tool_result`, `command`, `output`, `error`, `usage`.
3. `FakeEngine` driven by a script fixture (used by all daemon and e2e tests).
**Done when:**
- [ ] The daemon runs a full fake run end to end in tests with no real CLI.
**Deps:** P1-07-06 · **Touches:** engines, daemon · **Size:** M

### P1-08-05 · Claude Code driver
**Steps:**
1. Spawn `claude -p --output-format stream-json --verbose` (plus the flags needed for unattended work, documented in the driver) in the worktree.
2. Map stream events to normalized entries; capture tokens and turns, and any usage-window or rate-limit message the CLI prints (subscription billing, Q2).
3. Recorded stream fixtures for tests; a live smoke test only when `MOTES_RUN_REAL_AGENT_SMOKE=1`.
**Done when:**
- [ ] Fixture tests produce the expected entries and usage.
**Deps:** P1-08-04 · **Touches:** engines · **Size:** M

### P1-08-06 · Codex driver
**Steps:**
1. Drive the Codex app server (JSON-RPC over stdio) in the worktree.
2. Same mapping, usage capture and fixture/live split as P1-08-05.
**Done when:**
- [ ] Fixture tests pass.
**Deps:** P1-08-04 · **Touches:** engines · **Size:** M

### P1-08-07 · OpenCode driver
**What this is:** support for OpenCode as an engine, which also gives access to local models (Ollama, LM Studio) and to providers the owner has logged in to through OpenCode.
**Steps:**
1. Drive OpenCode in its headless or server mode inside the worktree; select provider and model per run.
2. Same normalized log mapping, usage capture and fixture/live split as P1-08-05.
**Done when:**
- [ ] Fixture tests pass, including one run on a local model fixture.
**Deps:** P1-08-04 · **Touches:** engines · **Size:** M

### P1-08-08 · Cursor CLI driver
**Steps:**
1. Drive the Cursor agent CLI in headless mode with streamed JSON output inside the worktree.
2. Same mapping, usage capture and fixture/live split as P1-08-05.
3. Document in the driver how to add the next CLI (a checklist), so new engines are one card each.
**Done when:**
- [ ] Fixture tests pass; the "adding an engine" checklist exists in `packages/engines/README.md`.
**Deps:** P1-08-04 · **Touches:** engines · **Size:** M

### P1-08-09 · Execution log ingestion
**What this is:** sending log entries from the daemon to the server and to clients.
**Steps:**
1. Daemon batches entries (every 250 ms or 50 entries) to `POST /daemon/runs/:id/log` with sequence numbers.
2. Table `run_log` (`runId`, `seq`, `ts`, `type`, `data`); large outputs truncated with a pointer to a stored blob.
3. Event `run.log_appended` (ids only) so clients fetch new entries.
4. Daemon also writes each `command` entry to the audit feed (wired to the audit log in P2-01-03).
**Done when:**
- [ ] Test: entries arrive in order even when batches are retried; duplicates are ignored by `seq`.
**Deps:** P1-08-04, P0-04-07 · **Touches:** daemon, server, domain, db · **Size:** M

### P1-08-10 · Cancel a run
**Steps:**
1. `POST /runs/:id/cancel` → state `cancelled` requested; daemon receives it (WS nudge or next heartbeat) and calls `stop()`.
2. If the engine does not stop in 10 s, kill the process group.
**Done when:**
- [ ] Test with the fake engine: cancel stops it and the run ends `cancelled`.
**Deps:** P1-08-09 · **Touches:** server, daemon, engines · **Size:** S

### P1-08-11 · Steering a running run
**What this is:** a new message for a bot while it is already working on the card.
**Steps:**
1. If the engine supports input mid-run, deliver through `send()`; otherwise queue the message for the next run.
2. Record which path was used in the run log.
**Done when:**
- [ ] Tests cover both paths with the fake engine.
**Deps:** P1-08-05, P1-08-06, P1-08-10 · **Touches:** engines, daemon, domain · **Size:** M

### P1-08-12 · Retries, timeouts and stalls
**Steps:**
1. Stall detection by inactivity (no log entry for N minutes, configurable), not by total time.
2. Max run time from the bot's `limits`.
3. Retry policy: failed with a retryable reason (`runtime_lost`, `stalled`, engine crash) → one retry by default; `attempt` incremented.
4. Clear `failureReason` shown on the card timeline.
**Done when:**
- [ ] Test with a fake clock: a stalled run fails as `stalled` and is retried once.
**Deps:** P1-08-09 · **Touches:** domain, daemon · **Size:** M

### P1-08-13 · Run screens `UI · visual TBD`
**Steps:**
1. Run list on the card (state, bot, engine, runtime, duration, usage).
2. Run detail with the live log (virtualized list), cancel button, "run again".
**Done when:**
- [ ] Manual: log streams live during a fake run; scroll stays usable with 10 000 entries.
**Deps:** P1-08-09, P1-04-03 · **Touches:** views, core · **Size:** M

---

## P1-09 · Review

### P1-09-01 · Commit and push the branch
**What this is:** at the end of a successful run, the daemon makes sure the work is committed and pushed to the run's branch.
**Steps:**
1. If the engine left uncommitted changes, commit them with the run summary as message.
2. `git push -u origin <branch>`; never push to the default branch (hard check before pushing).
3. If there are no changes, end the run as `completed` with a "no changes" note.
**Done when:**
- [ ] Test against a temp bare remote: the branch exists remotely; an attempt to push the default branch is refused.
**Deps:** P1-08-09 · **Touches:** daemon · **Size:** S

### P1-09-02 · Open the pull request
**Steps:**
1. Use `gh pr create` with the machine's own `gh` login (DESIGN §7); title `KEY-n: card title`, body with summary, link back to the card.
2. Store PR url, number and state on the card (`card_pull_requests` table, a card can have several).
3. If `gh` is not logged in, fail the review step with a clear reason (the branch is still pushed).
**Done when:**
- [ ] Test with a fake `gh` binary: the PR record is stored.
**Deps:** P1-09-01 · **Touches:** daemon, domain, db · **Size:** S

### P1-09-03 · Card to review with a diff summary
**Steps:**
1. On PR creation, the card moves to `in_review` (system transition) and the timeline gets an activity entry with files changed, additions, deletions.
2. Event `card.review_requested`.
**Done when:**
- [ ] Test: completing a fake run with changes ends with the card `in_review` and the activity entry.
**Deps:** P1-09-02 · **Touches:** domain · **Size:** S

### P1-09-04 · PR status sync `Pending owner decision (Q1)`
**What this is:** Motes learning when the owner merges or closes a PR on GitHub, or comments on it.
**Steps:**
1. A sync job on the hub polling `gh pr view` for open PRs every few minutes (webhooks come later with P5-01-03).
2. Merged → card `done`; closed without merge → card back to `todo` with an activity entry.
3. New review comments → activity entry and event `card.review_commented` (a dev bot mention in a review comment queues a run).
**Done when:**
- [ ] Test with a fake `gh`: merged and closed PRs move cards correctly.
**Deps:** P1-09-03 · **Touches:** domain, server · **Size:** M

### P1-09-05 · Merge from Motes `Pending owner decision (Q1)`
**What this is:** merging a PR from the app (and later from chat through the Boss).
**Assumption until Q1 is answered:** merging from Motes always requires an explicit owner action in the app or an approval code in chat (P4-06-04); a plain message is never enough.
**Steps:**
1. `POST /cards/:id/pull-requests/:pr/merge` (owner only) runs `gh pr merge` with the configured strategy.
2. Audit entry for every merge (wired in P2).
**Done when:**
- [ ] Test with a fake `gh`: merge succeeds and the card goes `done`.
**Deps:** P1-09-04 · **Touches:** server, domain · **Size:** S

### P1-09-06 · Review panel `UI · visual TBD`
**Steps:**
1. On a card in review: PR link and state, diff summary, "merge", "request changes" (comment that mentions the dev bot).
**Done when:**
- [ ] Manual: "request changes" queues a new run with the comment as instruction.
**Deps:** P1-09-05, P1-04-03 · **Touches:** views · **Size:** S

---

## P1-10 · Inbox and usage

### P1-10-01 · Usage records
**What this is:** what each run consumed from the owner's subscriptions.
**Steps:**
1. Table `usage_records` (`runId`, `botId`, `cardId?`, `engine`, `model`, tokens, turns, `durationMs`, `estimatedUsd?` (only if the CLI reports it), `recordedAt`).
2. Table `usage_limits` per engine: limit messages and reset times parsed from the CLI output (e.g. "usage limit reached, resets at ...").
**Done when:**
- [ ] Test: a fake run's usage is recorded once even if the daemon retries the report; a fixture limit message produces a `usage_limits` row with the reset time.
**Deps:** P1-08-05 · **Touches:** db, domain · **Size:** S

### P1-10-02 · Usage rollups and limit handling
**Steps:**
1. Rollups per bot, card, project, engine and day (runs, turns, tokens, minutes).
2. When an engine reports a usage-window limit, the daemon stops claiming runs for that engine until the reset time and the server emits `engine.limited`. If the bot lists another engine in its preference order, the run can go to that engine instead.
3. Routes `GET /usage?groupBy=bot|card|project|engine|day&from&to`.
**Done when:**
- [ ] Test: a limit signal pauses claims for that engine only, a bot with a second engine falls back to it, and claims resume after the reset time (fake clock).
**Deps:** P1-10-01, P1-07-05 · **Touches:** domain, daemon, server · **Size:** M

### P1-10-03 · Inbox items
**What this is:** the list of things that need the owner.
**Steps:**
1. Table `inbox_items` (`kind` `review|failure|question|approval|budget|limit`, `subject`, `state` `open|read|done`, timestamps).
2. A projector creating items from events (`card.review_requested`, `run.failed` after the last retry, `engine.limited`); items close automatically when their subject resolves.
3. Routes and `core` hooks; event `inbox.changed`.
**Done when:**
- [ ] Test: a review request opens one item; merging closes it.
**Deps:** P1-09-03, P1-10-02 · **Touches:** db, domain, server, core · **Size:** M

### P1-10-04 · Inbox and usage screens `UI · visual TBD`
**Steps:**
1. Inbox page with filters by kind; unread badge in the sidebar; desktop notification for new `failure` and `approval` items.
2. Usage on the card, the bot page and a simple usage page (table by day, bot and engine, with current usage-window status per CLI).
**Done when:**
- [ ] Gate P1 passes.
**Deps:** P1-10-03, P1-08-13 · **Touches:** views, desktop · **Size:** M
