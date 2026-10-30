# Database access and migrations

`createDb(url)` returns the PostgreSQL Drizzle client. Close its pool with
`await db.$client.end()` during shutdown. Business tables belong in
`src/schema.ts`; this card intentionally introduces none.

From the repository root, with Node 24 and dependencies installed:

```sh
pnpm db:up
pnpm db:generate add_table_name
pnpm db:check
pnpm db:migrate
```

`db:generate` uses Drizzle Kit's PostgreSQL API to write
`migrations/NNNN_name.sql` and the matching `migrations/meta/NNNN_name.json`
snapshot. Review the SQL by hand and commit both files. An unchanged schema
creates no files. Kit v1's stock CLI uses timestamped directories, so use the
repository command to preserve the roadmap's numbered SQL convention.
Ambiguous or destructive diffs requiring Kit hints fail closed; no changes
are written when generation cannot determine the intended operation.

`db:check` compares the current schema with the latest migration snapshot
without changing files or connecting to Postgres. It exits nonzero for an
ungenerated schema change, invalid metadata, or a missing SQL/snapshot pair.
It checks repository history, not drift in a running database. The initial
empty schema requires no baseline migration. The full `pnpm check` gate includes this check.

`db:migrate` reads `DATABASE_URL` from the environment or the repository's
local configuration file. It creates the infrastructure-only
`schema_migrations` ledger, sorts the SQL filenames, and commits each pending
file and its ledger row in one transaction. A failed file rolls back; earlier
files stay committed. An advisory transaction lock serializes concurrent
runners. Applied file hashes are checked before further migration work;
never edit, remove, or insert a file before applied history. Add a new
numbered migration instead. No foreign-key cascades: clean dependents in
application code inside the transaction, as required by `AGENTS.md`.

## Versions and strict typing

The catalog pins `drizzle-orm` and `drizzle-kit` to `1.0.0-rc.5` and
`postgres` to `3.4.7`. These matched ORM/Kit releases support the same schema
format. They are prereleases; upgrades must recheck generation, round trips,
rollback, and the full strict TypeScript gate.

`patches/drizzle-orm@1.0.0-rc.5.patch` fixes published declarations only:
policy/role options admit explicit `undefined`, matching their implemented
classes, and `TextDecoder` is imported as a Node type. ESM and CommonJS
declarations receive the same fixes. No runtime code or compiler check is
changed. Remove the patch once an upstream release passes these checks.

`mysql2`, `@electric-sql/pglite`, and `@types/emscripten` are development-only dependencies needed
by transitive declarations exposed by ORM/Kit, even for the PostgreSQL
entry points. The generator explicitly references the DOM and Emscripten type
libraries required by PGlite's declarations. They are never used as Motes
database drivers. No additional production service is required. Client/core
compilation keeps its existing library restrictions.

## Tests

Set `DATABASE_URL` to a development/test Postgres 17 instance whose role can
create databases, then run `pnpm test --project packages/db` or `pnpm check`.
The bootstrap tests create and drop uniquely named databases. They never run
migrations in the configured database. The shared template-based
`withTestDb()` remains P0-03-03's responsibility; these tests must exercise the
runner on an initially unmigrated database.
