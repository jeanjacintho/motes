# Motes

Motes is a personal, self-hosted workspace where a team of AI bots works on
its owner's projects. A board connects cards, runs, execution logs and review
so autonomous work stays visible and traceable.

The owner talks to one assistant, the Boss, which coordinates the team,
reports progress and asks for human decisions. The server runs on the hub Mac;
machine daemons drive the agent CLIs the owner is already logged in to, using
the owner's subscriptions rather than model API keys.

## Local development

Install Git, Node 24 LTS and pnpm 10.33.2 (pinned in `package.json`). With nvm
installed, `nvm install` and `nvm use` select the version from `.nvmrc`.
From a clean clone:

```sh
git clone https://github.com/jeanjacintho/motes.git
cd motes
nvm install
nvm use
npm install --global pnpm@10.33.2
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

`pnpm check` runs lint (including package boundaries), typechecking and tests.
For focused work, use `pnpm boundaries`, `pnpm typecheck`, `pnpm test` or
`pnpm test:watch`. `pnpm format` formats supported source files.

The current foundation provides workspace tooling; runnable server and desktop
apps arrive in later P0 cards. Postgres setup (`pnpm db:up`, P0-03-01) and the
combined app command (`pnpm dev`, P0-06-03) are planned and are not available yet.

## Contributing

Read [AGENTS.md](AGENTS.md) before changing the repo. Deliver one card per PR
and use `type(scope): summary (Pn-EE-CC)` for commits and PR titles.

- [Design and architecture](docs/DESIGN.md)
- [Roadmap and phase index](docs/ROADMAP.md)
- [Foundation cards](docs/roadmap/P0-foundation.md)
- [Build and TypeScript configuration](docs/build.md)
- [Testing guide](docs/testing.md)
