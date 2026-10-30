# P0 · Foundation

> Back to [ROADMAP](../ROADMAP.md) · Design refs: DESIGN §7 (technology), §8 (layout and boundaries)

**Goal of the phase:** an empty but correct skeleton. Every later card plugs into it without moving anything. At the end, the desktop app connects to the server with a device token and shows events arriving live.

**Gate P0:** `pnpm check` green in CI; on a clean Mac, `pnpm db:up && pnpm dev` starts Postgres, the server and the desktop app; the app pairs with the server and its live event counter increases when a test event is emitted.

---

## P0-01 · Repository

### P0-01-01 · Workspace scaffold
**What this is:** the empty monorepo: pnpm workspaces, Turborepo, and one folder per app and package listed in DESIGN §8, each with its own `package.json`.
**Why:** every later card adds code to one of these folders. Getting names and layout right once avoids renames later.
**Steps:**
1. Root `package.json` with `"type": "module"`, `packageManager` pinned to pnpm 10, `engines.node` `>=24 <25`.
2. `pnpm-workspace.yaml` with `apps/*` and `packages/*`; a `catalog:` section for shared dependency versions.
3. `turbo.json` with `build`, `typecheck`, `test`, `lint` pipelines and correct `dependsOn`.
4. Create `apps/{server,daemon,desktop,web}` and `packages/{protocol,db,domain,decision,bots,channels,security,engines,core,ui,views}`, each with `package.json` (`@motes/<name>`, private) and a `src/index.ts` exporting nothing yet.
5. `.gitignore`, `.editorconfig`, `.nvmrc` (24).
**Done when:**
- [ ] `pnpm install` succeeds on a clean clone.
- [ ] `pnpm -r exec pwd` lists all 15 workspaces.
**Out of scope:** TypeScript build (P0-01-02), lint (P0-01-03).
**Deps:** none · **Touches:** root, all folders · **Size:** S

### P0-01-02 · TypeScript configuration and build
**What this is:** the shared compiler settings and how each package is built.
**Why:** strict types across package boundaries are the main defense against drift between server and clients.
**Steps:**
1. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module`/`moduleResolution` `NodeNext` for Node packages, `verbatimModuleSyntax`.
2. Per-package `tsconfig.json` extending the base, with project references between packages.
3. Server-side packages build to `dist/` with `tsc -b`. Client packages (`core`, `ui`, `views`) export raw TypeScript consumed by the apps' bundlers (same approach as the architecture model).
4. Root scripts: `build`, `typecheck` through Turborepo.
**Done when:**
- [ ] `pnpm build` and `pnpm typecheck` pass.
- [ ] A deliberate type error in `packages/protocol` fails `pnpm typecheck` from the root.
**Out of scope:** app bundlers (desktop and web cards).
**Deps:** P0-01-01 · **Touches:** root, all packages · **Size:** S

### P0-01-03 · Lint and format
**What this is:** Biome as the single linter and formatter.
**Why:** one fast tool, one style, no debates in PRs.
**Steps:**
1. Add Biome to the root with `biome.json` (recommended rules, 2-space indent, single quotes, line width 100).
2. Scripts `lint` (`biome check .`) and `format` (`biome format --write .`).
3. Ignore `dist`, generated files and lockfiles.
**Done when:**
- [ ] `pnpm lint` passes on the scaffold and fails on a file with an unused variable.
**Out of scope:** boundaries rules (P0-01-05).
**Deps:** P0-01-01 · **Touches:** root · **Size:** S

### P0-01-04 · Test runner
**What this is:** Vitest configured for the whole workspace, with Node and DOM environments.
**Why:** every card ships tests; they must run the same locally and in CI.
**Steps:**
1. Root `vitest.config.ts` using `projects` per workspace.
2. Default environment `node`; `ui`, `views` and `desktop` renderer use `jsdom` and Testing Library.
3. A sample test in `packages/protocol` so the suite is never empty.
4. Script `test` (`vitest run`) and `test:watch`.
**Done when:**
- [ ] `pnpm test` runs the sample test and passes.
- [ ] A test in `packages/ui` can render a React component.
**Out of scope:** Playwright end-to-end (added with the desktop app in P0-06-03).
**Deps:** P0-01-02 · **Touches:** root, protocol, ui · **Size:** S

### P0-01-05 · Package boundaries check
**What this is:** a script that reads every import in the workspace and fails when an import breaks the rules of DESIGN §8.
**Why:** boundaries that are only written down erode. This makes the architecture enforceable.
**Steps:**
1. `scripts/check-boundaries.ts`: parse imports with the TypeScript compiler API (no regex).
2. Encode the allowed graph: `views → core, ui, protocol`; `core → protocol`; `ui → (nothing internal)`; `domain → db, protocol, security, decision`; `apps/* → packages/*`; `packages/* ↛ apps/*`.
3. Encode the forbidden external imports: `domain` must not import `fastify`, `electron`, `react`; `core` must not import `react-dom`; `ui` must not import `@motes/core`; `views` must not create Zustand stores (`zustand` `create` import).
4. Print every violation with file and line; exit code 1 on any.
5. Add `pnpm boundaries` and include it in `pnpm lint`.
**Done when:**
- [ ] Fixture files with a forbidden import make the script fail with a clear message.
- [ ] The scaffold passes.
**Out of scope:** runtime checks.
**Deps:** P0-01-02 · **Touches:** scripts, root · **Size:** M

### P0-01-06 · Continuous integration
**What this is:** a GitHub Actions workflow that runs the full check on pull requests.
**Why:** cards are built by agents; CI is the first reviewer.
**Steps:**
1. `.github/workflows/ci.yml`: checkout, pnpm setup with cache, Node 24, `pnpm install --frozen-lockfile`.
2. Postgres 17 service container exposed on 5432 with a test password (for DB tests from P0-03).
3. Run `pnpm check` = `lint && typecheck && test`.
4. Root script `check` chaining the three.
**Done when:**
- [ ] A PR shows the CI check and it passes.
- [ ] A PR with a lint error shows it failing.
**Out of scope:** release builds (P7).
**Deps:** P0-01-05, P0-01-04 · **Touches:** `.github`, root · **Size:** S

### P0-01-07 · Builder instructions
**What this is:** the files that tell any coding agent how to work in this repo.
**Why:** agents build Motes card by card; without shared instructions each run invents its own conventions.
**Steps:**
1. `AGENTS.md`: reading order (DESIGN → ROADMAP → phase file → the card), package boundaries table, state rules (DESIGN §8), testing rules, "one card per PR", commit format `type(scope): summary (Pn-EE-CC)`, English for code/docs, pt-BR for UI text.
2. `CLAUDE.md` containing only `@AGENTS.md`.
3. `README.md`: what Motes is (two paragraphs), local setup commands, link to docs.
4. `.github/pull_request_template.md`: card id, what changed, how it was tested, checks run.
**Done when:**
- [ ] The files exist and their rules match DESIGN §8 word for word where they overlap.
**Out of scope:** user documentation.
**Deps:** P0-01-01 · **Touches:** root docs · **Size:** S

---

## P0-02 · Protocol (`packages/protocol`)

The shared language between server, daemon and clients. Only zod and pure functions; no I/O.

### P0-02-01 · Ids
**What this is:** typed, prefixed, time-sortable identifiers for every entity (`prj_`, `card_`, `bot_`, `run_`, `rt_`, `msg_`, `evt_`…).
**Why:** a prefix tells you the type at a glance in logs and URLs; sortable ids give stable ordering without extra columns.
**Steps:**
1. Implement `newId(prefix)` using a ULID-style body (timestamp + randomness).
2. A zod schema factory `idSchema('card')` that validates prefix and body.
3. Branded TypeScript types (`CardId`, `RunId`…) so ids of different types cannot be mixed.
4. Export a single `ID_PREFIXES` table; later cards add entries there.
**Done when:**
- [ ] Tests: generation is sortable by time; `idSchema('card')` rejects `run_…` and malformed bodies; branded types fail to compile when mixed (a `// @ts-expect-error` test).
**Out of scope:** database columns (P0-03).
**Deps:** P0-01-04 · **Touches:** protocol · **Size:** S

### P0-02-02 · Base schemas
**What this is:** schemas used by every API: ISO timestamps, pagination (cursor-based), the error envelope, money/usage numbers.
**Why:** one definition of "a page" and "an error" keeps every route and client consistent.
**Steps:**
1. `timestampSchema` (ISO 8601 string, UTC).
2. `pageRequestSchema` (`cursor?`, `limit` 1–200) and `pageSchema(item)` (`items`, `nextCursor`).
3. `apiErrorSchema` (`code`, `message`, `details?`, `requestId`) and a list of stable error codes (`unauthorized`, `not_found`, `validation_failed`, `conflict`, `rate_limited`, `internal`).
4. `usageSchema` (input/output/cached tokens, turns, `durationMs`, `estimatedUsd?` shown only when a CLI reports it; billing is the owner's subscriptions).
**Done when:**
- [ ] Tests for valid and invalid inputs of each schema.
**Out of scope:** entity schemas (added by the cards that create each entity).
**Deps:** P0-02-01 · **Touches:** protocol · **Size:** S

### P0-02-03 · Tolerant parsing for clients
**What this is:** `parseWithFallback(schema, data, fallback)` and helpers for enums with an `unknown` member.
**Why:** an installed desktop app may talk to a newer server. It must degrade, not crash, when it sees a field or enum value it does not know.
**Steps:**
1. `parseWithFallback` returns parsed data or the fallback and reports the issue to a pluggable logger.
2. `tolerantEnum(values)` maps unknown strings to `'unknown'`.
3. Document the rule in a short comment: clients parse with these helpers; the server parses strictly.
**Done when:**
- [ ] Tests: an extra field is stripped; an unknown enum becomes `'unknown'`; a missing required field returns the fallback.
**Out of scope:** the API client itself (P0-05-01).
**Deps:** P0-02-02 · **Touches:** protocol · **Size:** S

### P0-02-04 · Event envelope and registry
**What this is:** the shape of every event in the system and a registry where each feature declares its event types and payload schemas.
**Why:** events drive realtime UI updates now and bot triggers later (P5). A single typed registry keeps producers and consumers in sync.
**Steps:**
1. `eventEnvelopeSchema`: `id` (`evt_`), `type`, `occurredAt`, `actor` (`{ kind: 'owner' | 'bot' | 'system' | 'runtime', id? }`), `subject` (`{ kind, id }`), `payload`.
2. `defineEvent(type, payloadSchema)` returning a typed descriptor; a registry object collecting descriptors.
3. `parseEvent(raw)`: known types parse their payload strictly on the server; clients get an `unknown` event variant for types they do not know.
4. Register one test event `system.ping` (used by the P0 gate).
**Done when:**
- [ ] Tests: a known event round-trips; an unknown type becomes the fallback variant on the client parser.
**Out of scope:** storage (P0-03-04) and delivery (P0-04-07).
**Deps:** P0-02-03 · **Touches:** protocol · **Size:** M

### P0-02-05 · Canonical JSON and digest
**What this is:** deterministic JSON serialization and a SHA-256 digest over it.
**Why:** capability rule keys (P2) and approval binding need the same digest for the same content, regardless of key order.
**Steps:**
1. `canonicalJson(value)`: sorted keys, no whitespace, rejects `undefined`, functions, non-finite numbers.
2. `digest(value)`: hex SHA-256 of the canonical JSON, using `node:crypto` (server side only; mark the export as Node-only).
**Done when:**
- [ ] Tests: key order and whitespace do not change the digest; nested arrays keep order; invalid values throw.
**Out of scope:** capability normalization (P2-02-01).
**Deps:** P0-02-01 · **Touches:** protocol · **Size:** S

---

## P0-03 · Database (`packages/db`)

### P0-03-01 · Local Postgres
**What this is:** a reproducible local Postgres for development and tests.
**Why:** every developer machine and CI must run the same database version.
**Steps:**
1. `docker-compose.yml` with Postgres 17, a named volume, port 5432, health check.
2. Scripts `db:up`, `db:down` (keeps data), `db:reset` (drops the volume, asks for confirmation with a flag).
3. Config: `DATABASE_URL` read from `.env` (an `.env.example` committed, `.env` ignored).
4. Document Postgres.app as an alternative in the README.
**Done when:**
- [ ] `pnpm db:up` starts Postgres and `psql $DATABASE_URL -c 'select 1'` works.
**Out of scope:** migrations.
**Deps:** P0-01-01 · **Touches:** root · **Size:** S

### P0-03-02 · Drizzle and migration runner
**What this is:** the database access library and the way schema changes are applied.
**Why:** schema must evolve safely across the hub's lifetime; one migration path for dev, CI and production.
**Steps:**
1. Add Drizzle with the `postgres` driver in `packages/db`; a `createDb(url)` factory.
2. Migrations as plain SQL files in `packages/db/migrations/NNNN_name.sql`, generated with drizzle-kit and reviewed by hand.
3. A runner that applies pending files in order inside a transaction each and records them in `schema_migrations`.
4. Scripts: `db:generate`, `db:migrate`, `db:check` (fails when the Drizzle schema and the migrations differ).
5. Rule in `AGENTS.md`: no foreign-key cascades; dependents are cleaned up in application code inside a transaction.
**Done when:**
- [ ] Running `db:migrate` twice is a no-op.
- [ ] `db:check` fails when a schema change has no migration.
**Out of scope:** any business table.
**Deps:** P0-03-01, P0-01-02 · **Touches:** db · **Size:** M

### P0-03-03 · Test database helper
**What this is:** a helper that gives each test file its own migrated database.
**Why:** tests running in parallel must not see each other's data.
**Steps:**
1. `withTestDb()` creates `motes_test_<random>` from a migrated template database, returns a Drizzle instance, drops it after the file.
2. Template database created once per test run (global setup) to keep tests fast.
3. A fixtures helper module (`fx.insert…`) that later cards extend.
**Done when:**
- [ ] Two test files writing the same row in parallel both pass.
- [ ] CI uses the Postgres service from P0-01-06.
**Out of scope:** fixtures for specific entities.
**Deps:** P0-03-02 · **Touches:** db · **Size:** S

### P0-03-04 · Event outbox
**What this is:** the `events` table where every domain event is written in the same transaction as the change that caused it.
**Why:** if the change commits, the event exists; if it rolls back, it never happened. Realtime clients and (later) bot triggers read from this table.
**Steps:**
1. Table `events`: `seq` (bigserial, the global order and resume cursor), `id`, `type`, `occurred_at`, `actor`, `subject_kind`, `subject_id`, `payload` (jsonb).
2. Repository `appendEvent(tx, envelope)` validating with the registry from P0-02-04.
3. `readEventsAfter(seq, limit)` for delivery.
4. Postgres `NOTIFY motes_events` after insert so the server wakes without polling.
**Done when:**
- [ ] Test: an event appended in a rolled-back transaction does not exist.
- [ ] Test: `readEventsAfter` returns events in `seq` order.
**Out of scope:** delivery to clients (P0-04-07); trigger matching (P5).
**Deps:** P0-03-03, P0-02-04 · **Touches:** db · **Size:** M

---

## P0-04 · Server (`apps/server` + `packages/domain`)

### P0-04-01 · Config and logging
**What this is:** how the server reads its settings and writes logs.
**Why:** every later module needs config and a logger; doing it once keeps them uniform.
**Steps:**
1. `loadConfig()` reading env (`DATABASE_URL`, `MOTES_PORT`, `MOTES_DATA_DIR`, `LOG_LEVEL`) validated with zod; fails fast with a readable message.
2. Data directory default `~/Library/Application Support/Motes`.
3. Structured JSON logger (pino) with a redaction list (`authorization`, `token`, `secret`, `password`).
**Done when:**
- [ ] Missing `DATABASE_URL` prints one clear error and exits 1.
- [ ] A test shows a redacted header in log output.
**Out of scope:** secrets storage (P2-05).
**Deps:** P0-01-02 · **Touches:** server · **Size:** S

### P0-04-02 · Fastify bootstrap, health and shutdown
**What this is:** the HTTP server process.
**Why:** the base for every route.
**Steps:**
1. Fastify instance with request ids, the logger from P0-04-01, JSON body limit.
2. `GET /health`: version, uptime, database reachable (`select 1`), migrations up to date.
3. Run pending migrations on start (configurable).
4. Graceful shutdown on SIGTERM/SIGINT: stop accepting, drain, close DB.
5. `pnpm dev:server` with watch mode.
**Done when:**
- [ ] `curl localhost:$PORT/health` returns 200 with the fields above.
- [ ] Test: SIGTERM closes within 5 s with no open handles.
**Out of scope:** auth (P0-04-04).
**Deps:** P0-04-01, P0-03-02 · **Touches:** server · **Size:** S

### P0-04-03 · Composition root and error mapping
**What this is:** the single place where services are created and wired, and the mapping from domain errors to HTTP responses.
**Why:** routes stay thin (parse → call domain → serialize), and `domain` stays free of Fastify (DESIGN §8).
**Steps:**
1. `packages/domain/src/errors.ts`: `NotFound`, `Conflict`, `ValidationFailed`, `Forbidden` domain errors.
2. `apps/server/src/composition.ts` building a `Services` object (db, event appender, clock, id generator) passed to route plugins.
3. Fastify error handler mapping domain errors and zod errors to `apiErrorSchema` with the right status.
4. A route helper `route({ method, url, body, query, response, handler })` that validates input and output with zod.
**Done when:**
- [ ] Test: a handler throwing `NotFound` returns 404 with the error envelope; invalid body returns 400 with field details.
**Out of scope:** any business route.
**Deps:** P0-04-02 · **Touches:** server, domain · **Size:** M

### P0-04-04 · Owner pairing and device tokens
**What this is:** how a client proves it belongs to the owner. There is one owner and no passwords: a one-time setup code pairs a device, which then holds a long-lived token.
**Why:** the server will be reachable over Tailscale; every request must be authenticated.
**Steps:**
1. Table `device_tokens`: `id`, `name`, `kind` (`client` | `daemon`), `token_hash` (SHA-256), `created_at`, `last_used_at`, `revoked_at`.
2. On first start (no tokens), print a setup code (8 chars, 10-minute expiry) to the log and to `motes-server pair` CLI output.
3. `POST /pair` exchanges a valid code + device name for a token returned once.
4. Codes are single use; five wrong attempts lock pairing for 10 minutes.
**Done when:**
- [ ] Test: a code works once; an expired code fails; the plain token is never stored.
**Out of scope:** daemon token minting from the app (P1-05-01).
**Deps:** P0-04-03 · **Touches:** server, domain, db, protocol · **Size:** M

### P0-04-05 · Auth middleware and device management
**What this is:** the check on every request plus routes to list and revoke devices.
**Why:** a lost laptop must be revocable from the app.
**Steps:**
1. Middleware reading `Authorization: Bearer`, hashing and looking up the token, rejecting revoked ones, updating `last_used_at` (throttled).
2. Attach `request.principal` (`{ deviceId, kind }`).
3. Routes `GET /devices`, `DELETE /devices/:id` (revoke).
4. All routes except `/health` and `/pair` require auth by default.
**Done when:**
- [ ] Test: no token → 401; revoked token → 401 on the next request.
**Out of scope:** per-route permissions.
**Deps:** P0-04-04 · **Touches:** server, domain · **Size:** S

### P0-04-06 · WebSocket endpoint
**What this is:** the authenticated realtime connection clients keep open.
**Why:** board, runs and chat update live without polling.
**Steps:**
1. `GET /ws` upgraded with `@fastify/websocket`, token in the first message (not in the URL).
2. Heartbeat ping/pong every 20 s; drop dead connections.
3. A connection registry keyed by device.
**Done when:**
- [ ] Test: unauthenticated socket is closed with a reason code; a dead client is removed after missed pongs.
**Out of scope:** event delivery (next card).
**Deps:** P0-04-05 · **Touches:** server · **Size:** S

### P0-04-07 · Event fan-out with resume
**What this is:** delivering events from the outbox to every connected client, and replaying missed ones after a reconnect.
**Why:** a laptop that sleeps must catch up exactly, with no gaps and no duplicates.
**Steps:**
1. Listen to `NOTIFY motes_events`; on notify, read new rows after the last delivered `seq` and broadcast.
2. Client sends `{ resumeAfter: seq }` on connect; server replays from there, then streams live.
3. If the gap is larger than a limit (e.g. 5 000 events), send `resync_required` so the client refetches.
4. Dev-only route `POST /dev/ping` that emits `system.ping` (used by the gate).
**Done when:**
- [ ] Test: a client reconnecting with a cursor receives exactly the missed events, in order.
**Out of scope:** per-entity subscriptions (all events go to the owner's devices).
**Deps:** P0-04-06, P0-03-04 · **Touches:** server, domain · **Size:** M

---

## P0-05 · Client packages

### P0-05-01 · API client (`packages/core`)
**What this is:** the typed client every UI uses to talk to the server.
**Why:** one place that knows URLs, auth and response parsing.
**Steps:**
1. `createApiClient({ baseUrl, getToken, fetch })`.
2. Each call declares its response schema and parses with `parseWithFallback` (P0-02-03).
3. Errors become a typed `ApiError` carrying the envelope.
4. First endpoints: `health`, `pair`, `devices.list`, `devices.revoke`.
**Done when:**
- [ ] Test: a malformed response returns the fallback and logs; a 401 surfaces as `ApiError('unauthorized')`.
**Out of scope:** React hooks (P0-05-03).
**Deps:** P0-04-05 · **Touches:** core · **Size:** S

### P0-05-02 · Storage and platform adapters (`packages/core`)
**What this is:** interfaces through which `core` reaches platform features without importing them.
**Why:** `core` must run in desktop, web and tests; it cannot touch `localStorage`, Keychain or Electron directly (DESIGN §8).
**Steps:**
1. `StorageAdapter` (get, set, remove; async) and `SecureStorageAdapter` (for the token).
2. `PlatformAdapter` (notifications, open external link).
3. In-memory implementations for tests.
**Done when:**
- [ ] `core` compiles with no DOM lib in its `tsconfig`; tests use the in-memory adapters.
**Out of scope:** real implementations (desktop card P0-06-02).
**Deps:** P0-05-01 · **Touches:** core · **Size:** S

### P0-05-03 · Query client and realtime wiring (`packages/core`)
**What this is:** TanStack Query setup and the WebSocket client that keeps caches fresh.
**Why:** state rule from DESIGN §8: Query owns server data; events invalidate or patch caches.
**Steps:**
1. `createQueryClient()` with sensible defaults (stale time, retry only on network errors).
2. `createRealtime({ url, getToken, storage })`: connects, authenticates, resumes from the stored cursor, reconnects with backoff, handles `resync_required` by invalidating everything.
3. `onEvent(type, handler)` registry; a helper `invalidateOn(type, queryKeyFn)`.
4. Hook `useConnectionStatus()`.
**Done when:**
- [ ] Test (fake socket): an event invalidates the registered query key; the cursor survives a reconnect.
**Out of scope:** entity-specific invalidations (each feature card adds its own).
**Deps:** P0-05-02, P0-04-07 · **Touches:** core · **Size:** M

### P0-05-04 · Design tokens and primitives (`packages/ui`) `UI · visual TBD`
**What this is:** the base visual vocabulary: CSS variables for color, type, spacing, radius, and a handful of accessible primitives.
**Why:** later skeleton screens need consistent building blocks, even before the final visual design.
**Steps:**
1. `styles/tokens.css` with semantic tokens (`--bg`, `--fg`, `--muted`, `--accent`, `--danger`, `--text-sm/md/lg`), light and dark.
2. Primitives: `Button`, `IconButton`, `Input`, `Textarea`, `Dialog`, `Menu`, `Tooltip`, `Toast`, `Spinner`, `Badge` built on an accessible headless library (builder's choice, justified in the PR).
3. A short `packages/ui/docs/` page per primitive with usage rules.
**Done when:**
- [ ] Component tests for keyboard focus and `aria` attributes; no import from `@motes/core`.
**Out of scope:** final colors and typography (P7).
**Deps:** P0-01-04 · **Touches:** ui · **Size:** M

### P0-05-05 · Navigation adapter and app shell (`packages/views`)
**What this is:** the shared layout and the abstraction that lets screens navigate without knowing the router.
**Why:** the same screens run in Electron and on the web (DESIGN §8).
**Steps:**
1. `NavigationAdapter` (`navigate(path)`, `currentPath`, `back()`), `NavigationProvider`, `useNavigation()`, `<AppLink>`.
2. `AppShell`: sidebar slot, top bar with connection status, content area.
3. A placeholder home screen.
**Done when:**
- [ ] Test renders `AppShell` with a fake adapter and navigates through `AppLink`.
**Out of scope:** real screens.
**Deps:** P0-05-04, P0-05-03 · **Touches:** views · **Size:** S

---

## P0-06 · Desktop app (`apps/desktop`)

### P0-06-01 · Secure Electron shell
**What this is:** the Electron app that hosts the shared views.
**Why:** the owner's main client in phase 1.
**Steps:**
1. electron-vite project with `main`, `preload`, `renderer`.
2. Security defaults: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, block navigation and new windows to unknown origins.
3. Preload exposes a single typed `window.motes` bridge (validated IPC channels only).
4. Renderer mounts `AppShell` with a memory-router `NavigationAdapter`.
**Done when:**
- [ ] `pnpm dev:desktop` opens a window showing the shell.
- [ ] Test: IPC handler rejects messages from an unexpected sender frame.
**Out of scope:** packaging and signing (P7).
**Deps:** P0-05-05 · **Touches:** desktop · **Size:** M

### P0-06-02 · Pair with the server `UI · visual TBD`
**What this is:** the first-run screen where the owner enters the server URL and setup code.
**Why:** the desktop app needs a device token to do anything.
**Steps:**
1. Keychain-backed `SecureStorageAdapter` in the main process (through the bridge).
2. Screen: server URL (default `http://localhost:<port>`), device name, setup code → `POST /pair` → store token.
3. Settings page listing devices with "revoke".
4. On 401 anywhere, return to the pairing screen.
**Done when:**
- [ ] Manual: pairing works against a local server; the token is in the Keychain, not on disk.
**Out of scope:** multiple servers.
**Deps:** P0-06-01 · **Touches:** desktop, views, core · **Size:** M

### P0-06-03 · Live status and end-to-end smoke test
**What this is:** the visible proof that realtime works, and the first Playwright test.
**Why:** this is the P0 gate.
**Steps:**
1. Top bar shows connection state (connected, reconnecting, offline) and a counter of received events.
2. `pnpm dev` starts server and desktop together.
3. Playwright (Electron mode) test: start server with a test DB, pair, call `POST /dev/ping`, assert the counter increments.
4. Add `test:e2e` to CI (can run on a macOS runner or headless Linux with xvfb).
**Done when:**
- [ ] Gate P0 passes by hand and the e2e test passes in CI.
**Out of scope:** any feature screen.
**Deps:** P0-06-02 · **Touches:** desktop, views, root · **Size:** M
