# Builder instructions

## Read before building

Read [DESIGN](docs/DESIGN.md), then [ROADMAP](docs/ROADMAP.md), the card's
phase file in `docs/roadmap/`, and finally the assigned card and its comments.
DESIGN is the source of truth; if a card conflicts with it, stop and ask for
clarification. Reference material is for reading only; never copy its code.

## Package boundaries

Responsibilities from DESIGN §8:

| Location | Responsibility |
|---|---|
| `apps/server` | Fastify bootstrap, route wiring, process lifecycle only |
| `apps/daemon` | machine runtime: registration, claim loop, worktrees, engine drivers |
| `apps/desktop` | Electron shell, desktop-only UI and platform adapters |
| `apps/web` | Vite app, web-only routing and platform adapters |
| `packages/protocol` | zod schemas, ids, event types, API contracts (no runtime deps beyond zod) |
| `packages/db` | Drizzle schema, migrations, repositories |
| `packages/domain` | server-side business logic: cards, runs, bots, triggers, handoffs (no HTTP, no UI) |
| `packages/decision` | tiered decision layer and model providers |
| `packages/bots` | office-bot runtime: agent loop, tool registry, memory |
| `packages/channels` | channel contract + adapters (plow, telegram, whatsapp) |
| `packages/security` | capabilities, rules, approvals, audit, secrets, Latch client |
| `packages/engines` | agent CLI drivers used by the daemon (claude, codex, fake) |
| `packages/core` | client headless logic: API client, Query hooks, Zustand stores (no UI, no DOM) |
| `packages/ui` | UI primitives and design tokens (no business logic, no core imports) |
| `packages/views` | shared screens and business components for web and desktop (no stores, no router) |

The following rules are copied verbatim from DESIGN §8:

- Dependency direction: `views → core + ui`; `core` and `ui` are independent. `apps/* → packages/*`, never the reverse.
- `domain` never imports Fastify, Electron or React. Routes in `apps/server` are thin: parse with zod, call `domain`, serialize.
- `channels`, `bots` and `decision` reach the rest of the system only through interfaces injected at composition time.
- TanStack Query owns server data, Zustand owns client state. WebSocket events patch or invalidate Query caches, never server payloads copied into Zustand.
- All JSON consumed by clients is parsed with the shared zod schema, with defaults for optional fields and a fallback for unknown enum values.
- Migrations: no cascading deletes; dependents are cleaned in application code inside a transaction **(builder's call, same as the model)**.
- A `pnpm boundaries` script checks the import graph and runs in CI.
- Code comments, commits and docs in English. UI text in pt-BR.

The import graph is enforced by `pnpm boundaries`. Keep workspace dependencies
and TypeScript project references aligned; use package exports rather than
cross-package source paths. Shared dependency versions belong in the pnpm catalog.

## Testing and validation

- Write tests for observable behavior next to the code (`src/**/*.test.ts` or
  `src/**/*.test.tsx`). Reproduce a bug with a failing test before fixing it.
- Use Vitest for unit and integration tests, and Testing Library for rendered
  behavior, keyboard interaction and accessibility. See [testing](docs/testing.md).
- Database tests use `withTestDb()` once P0-03-03 supplies it. Keep test data
  isolated; never use the owner's database.
- External adapters get fakes and recorded-fixture contract tests first. Live
  tests require an explicit environment flag; never require model API keys.
- Run each card's Done when checks and `pnpm check` before handing off. Run
  `pnpm db:up` first once P0-03-01 provides it for database tests. Until a script
  exists, run the available checks and report the limitation accurately.
- Record commands and results in the PR. Never weaken checks to make them pass.

## Deliver one card per PR

Keep the change within the card's scope and satisfy every Done when item.
Use the commit and PR title format `type(scope): summary (Pn-EE-CC)`.
Explain deviations, assumptions and new dependencies in the PR, and update docs
in the same PR when a DESIGN decision changes. Work lands in review; the owner
decides what reaches `main`.

Code, comments, commits, docs and PRs are in English. UI text is in pt-BR.
