# Server

Run `pnpm dev:server` from the repository root. Set `DATABASE_URL` to a Postgres
connection before starting it. `MOTES_PORT` defaults to 3000. `MOTES_SKILLS_DIR` (default `~/Motes/skills`) holds the bot folders under `bots/` and the shared skills under `shared/`; the server creates it as a git repository on first start and keeps the bot index in step with it while running. The server applies
pending migrations at startup; set `MOTES_MIGRATE_ON_START=false` to disable
that behavior. `GET /health` returns version, process uptime in seconds, database
availability and migration status, with HTTP 503 when either check fails.

On first startup the server logs a one-time setup code valid for ten minutes.
Run the built `motes-server pair` command on the server host to issue a fresh
code. `POST /pair` accepts `{ "code": "...", "name": "..." }` and returns
the device token once; protect the code and token as credentials. Five failed
attempts lock pairing for ten minutes. Authentication middleware and device
management follow in P0-04-05.

WebSocket clients authenticate with `{ "token": "...", "resumeAfter": "<seq>" }`.
The cursor is a decimal string; event messages contain `{ seq, event }`. After authentication fixes the delivery position, the server sends `{ "type": "ready" }`; events emitted after that message are delivered, so clients should report connected only then. If more
than `MOTES_REPLAY_LIMIT` events are pending (default 5000), the server sends
`{ "type": "resync_required" }` and closes the connection so the client can
refetch. Omitting the cursor starts at the current event head. The authenticated
`POST /dev/ping` route is enabled by `pnpm dev:server` or explicitly with
`MOTES_DEV_ROUTES=true`; do not enable it in production.

## Project routes

All routes require a device token. Errors use the protocol envelope: `400
validation_failed`, `404 not_found`, `409 conflict`.

| Route | Result |
|---|---|
| `GET /projects?includeArchived=true` | project list (archived hidden by default) |
| `POST /projects` | `201` with the new project; duplicate key is `409` |
| `PATCH /projects/:id` `{ name }` | renamed project |
| `POST /projects/:id/archive` | archived project (repeating it is a no-op) |
| `GET /projects/:id/repositories` | repositories with their checkout paths |
| `POST /projects/:id/repositories` | `201` with the new repository; the first one is primary |
| `PATCH /repositories/:id` | field changes; `isPrimary: true` promotes it (the only primary change) |
| `DELETE /repositories/:id` | `{ removed: true }`; the oldest remaining repository becomes primary |
| `PUT /repositories/:id/paths/:runtimeId` `{ localPath }` | the checkout path for that runtime |
| `POST /projects/:id/cards` | `201` with the new card, at the bottom of backlog on the primary repository by default |
| `GET /cards/:ref` | a card by id or `KEY-n`; deleted cards are `404` |
| `PATCH /cards/:id` | title, description, priority or repository |
| `POST /cards/:id/move` `{ status, beforeId?, afterId?, reason? }` | status change and/or reorder; `afterId` is the card directly above, `beforeId` directly below and they must be adjacent |
| `POST /cards/:id/assign` `{ assignee }` | the owner, a bot, or `null` to clear |
| `GET /bots` | the bot index: slug, name, kind, engines, `enabled`, `skillDigest` and `loadError` while the folder is broken |
| `GET /bots/:id` | the index row plus the config and `SKILL.md` read from disk (both `null` while the folder is broken) |
| `POST /bots` | `{ slug, displayName, kind, engines?, description? }`: a new folder from a template, committed to the skills repository; 409 if the name is taken |
| `PUT /bots/:id/skill` | `{ skill }`: the whole new `SKILL.md`, validated with the rest of the folder, written atomically and committed (`bot(<slug>): update behavior`) |
| `PATCH /bots/:id/config` | fields of `bot.yaml` (never the slug); comments and key order in the file are kept; committed (`update config`) |
| `DELETE /bots/:id` | removes the folder and commits it; 409 while the bot has running runs |
| `GET /bots/:id/history?limit=` | the commits that touched the bot's folder, newest first |
| `POST /bots/:id/revert/:commit` | undoes one commit of that bot's history with a new one; refused for the creation commit, for commits that touched other files, and when it no longer applies cleanly |
| `GET /projects/:id/board?assignee=&labelId=&priority=&text=` | every status as a column; `assignee` reads `bot:<id>` or `owner:owner` |
| `GET /cards/:id/timeline?cursor=&limit=` | comments and activity merged, oldest first; `limit` 1 to 100 (default 50), `nextCursor` is `null` on the last page; a deleted card keeps its history |
| `POST /cards/:id/comments` | `{ body }` markdown; 201 with the comment; `@slug` of a live bot is announced (`comment.mentioned`) |
| `PATCH /comments/:id` | `{ body }`; only the author edits |
| `DELETE /comments/:id` | soft delete by the author or the owner; answers `{ deleted: true }`, also when repeated |
