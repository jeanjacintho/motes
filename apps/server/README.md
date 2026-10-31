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
