# Workspace tests

Use Node 24 and the pinned pnpm version:

```sh
pnpm install --frozen-lockfile
pnpm db:up
pnpm test
pnpm test:watch
pnpm test --project packages/protocol --reporter verbose
```

The root [Vitest projects](https://vitest.dev/guide/projects) configuration
discovers every directory under `apps/` and `packages/`. Tests live next to
source as `src/**/*.test.ts` or `src/**/*.test.tsx`; build output is never
discovered. Empty workspaces need no placeholder tests. An entirely empty
suite fails by default.

Each workspace runs in Node except `ui`, `views` and `web`, which use jsdom.
Desktop has separate projects: `apps/desktop:renderer` covers
`src/renderer/**/*.test.{ts,tsx}` in jsdom; `apps/desktop:node` covers the
remaining source tests in Node, including main and preload code.

DOM projects use Testing Library with explicit cleanup after every test.
The UI smoke component stays inside its test file; it is not a production
primitive. New packages using React or Testing Library should declare their
own dependencies using the shared catalog versions.

Production TypeScript projects exclude test files so their declarations and
ambient types remain independent of test tooling. `pnpm typecheck` checks all
15 production workspaces, then checks the tests, runner configuration and DOM
setup with `tsconfig.test.json`, using Node and DOM test types without emitting
files. `pnpm build` continues to build production code only.

To verify failure propagation, temporarily add
`packages/protocol/src/failure-probe.test.ts`:

```ts
import { expect, test } from 'vitest';

test('reports a failed assertion', () => {
  expect(1).toBe(2);
});
```

Run `pnpm test`: the report must include the assertion failure and the command
must exit nonzero. Remove the probe and rerun `pnpm test`; it must pass.
The probe is a manual acceptance check, not committed source.

Database tests require `DATABASE_URL` in the process environment, pointing at a
test Postgres role with CREATEDB permission and access to the `postgres`
maintenance database. The test runner does not load local configuration files.
CI uses the existing Postgres 17 service. The root global setup creates one
migrated template per run; `withTestDb()` from `@motes/db/testing` clones it once
per test file and removes the clone when the file finishes. See
[database testing](../packages/db/README.md#tests) for usage and lifecycle details.
