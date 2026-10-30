# Database access and migrations

`createDb(url)` returns the PostgreSQL Drizzle client. Close its pool with
`await db.$client.end()` during shutdown. Tables belong in `src/schema.ts`.

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
create databases and connect to the `postgres` maintenance database, then run
`pnpm test --project packages/db` or `pnpm check`. The configured application
database is never migrated or written by the helper. CI already supplies this
role and URL through its Postgres service; no workflow change is required.

The root Vitest global setup creates one randomly named `motes_test_<random>`
database, migrates it, closes all template connections, and provides its name
to workers. Each `withTestDb()` clones that template in `beforeAll` and closes
its pool and drops the clone in `afterAll`, including after assertion failures.
The global teardown drops the template. Concurrent runs use different names.
Abrupt process termination cannot execute teardown and may leave test databases.

Register the helper once at file scope and read its properties inside tests or
subsequent hooks (destructuring `db` before setup runs is an error):

```ts
import { withTestDb } from '@motes/db/testing';
import { expect, test } from 'vitest';

const context = withTestDb();

test('uses a migrated, isolated database', async () => {
  const rows = await context.db.$client`SELECT to_regclass('schema_migrations') AS name`;
  expect(rows).toEqual([{ name: 'schema_migrations' }]);
});
```

`context.fx.insert(table).values(...)` provides the typed Drizzle insert builder.
The fixtures module is the extension point for future entity helpers; no entity
fixtures are introduced here. Tests within a file share a database and should
manage their own rows. The helper is also usable at suite scope.

Custom Vitest configurations must register `@motes/db/test-global-setup` as a
root `globalSetup` (build the package first). Import testing helpers only from
the testing subpath; production clients do not load Vitest.

Migration runner bootstrap tests deliberately use the underlying isolated
database lifecycle without cloning: they must start unmigrated and exercise
custom migration directories. All other database tests should use
`withTestDb()`.

## Event outbox

`appendEvent(tx, envelope)` strictly validates with the protocol registry and
inserts the event using the caller's Drizzle transaction. Pass the same
transaction used for the domain change; the appender never commits it.
Duplicate event ids fail. A rolled-back transaction exposes neither the
domain change nor its event. The returned `{ seq, event }` is provisional
until the caller's transaction commits. Timestamps are stored as UTC instants
with millisecond precision and read as ISO strings.

`readEventsAfter(db, seq, limit)` returns `{ seq, event }[]`, ordered by `seq`
and strictly after the supplied cursor. Start with `0n`; limits use the shared
pagination contract (1–200). Cursors stay `bigint` end to end; future wire
adapters must encode them as decimal strings, never JavaScript numbers.
Sequence gaps after rollback are expected.

All event producers must use `appendEvent`. It acquires a transaction advisory
lock before allocating a sequence, held until commit or rollback. Without
this serialization, a later sequence could commit first and let a replay
cursor skip an earlier event. Keep transactions short, and append events
after domain writes to avoid holding the global event lock during other work.
This deliberately serializes event-producing transactions at the append step.

Migration `0000_event_outbox.sql` includes the generated table and a manually
reviewed `AFTER INSERT` trigger. PostgreSQL delivers `NOTIFY motes_events`
with the decimal sequence as payload only after commit; rollback discards it.
The trigger and function are SQL-only objects outside Drizzle's table snapshot,
covered by integration tests. Notifications are wakeup hints; the outbox is
the durable source for replay. Listening, delivery and trigger matching belong
to later cards.
