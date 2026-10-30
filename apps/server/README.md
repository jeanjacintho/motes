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
