# Server

Run `pnpm dev:server` from the repository root. Set `DATABASE_URL` to a Postgres
connection before starting it. `MOTES_PORT` defaults to 3000. The server applies
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
| `GET /projects/:id/board?assignee=&labelId=&priority=&text=` | every status as a column; `assignee` reads `bot:<id>` or `owner:owner` |
