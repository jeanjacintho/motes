# Server

Run `pnpm dev:server` from the repository root. Set `DATABASE_URL` to a Postgres
connection before starting it. `MOTES_PORT` defaults to 3000. The server applies
pending migrations at startup; set `MOTES_MIGRATE_ON_START=false` to disable
that behavior. `GET /health` returns version, process uptime in seconds, database
availability and migration status, with HTTP 503 when either check fails.
