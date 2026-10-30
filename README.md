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
apps arrive in later P0 cards. The combined app command (`pnpm dev`, P0-06-03)
is planned and is not available yet.

### Local Postgres

Install Docker with Compose v2 or newer and start its engine. Install `psql`
(for example, `brew install libpq` and add its `bin` directory to `PATH`). Then:

```sh
cp .env.example .env
pnpm db:up
# Export DATABASE_URL from the local file for psql (never commit .env).
set -a
. ./.env
set +a
psql "$DATABASE_URL" -c 'select 1'
```

The commands load `.env` with Node's built-in loader; existing environment
variables take precedence. `DATABASE_URL` supplies the initial database name,
user and password. Docker publishes Postgres 17 on `127.0.0.1:5432` only;
the URL must target `localhost` or `127.0.0.1` on port 5432. `db:up` waits up to
60 seconds for the health check and fails if the database is not ready.

`pnpm db:down` stops the database and keeps the named `motes_postgres_data`
volume. `pnpm db:up` reuses it. Changing credentials in `.env` does not change
an already initialized database; keep its original settings or explicitly reset.
The unconfirmed `pnpm db:reset` refuses without contacting Docker. To delete
all local database data, run `pnpm db:reset --confirm`, then `pnpm db:up`.
Migrations are provided by a later card.

For a native alternative, install **Postgres.app** with PostgreSQL 17, add its
`bin` directory to `PATH`, initialize/start a server on port 5432, and use `psql`
to create a local login role with a password and a database owned by that role.
Set `DATABASE_URL` in `.env` to those credentials and that database. Use the
Postgres.app controls to start/stop it; the `db:*` scripts manage Docker only.
Stop the Docker database before starting Postgres.app on the same port.

## Contributing

Read [AGENTS.md](AGENTS.md) before changing the repo. Deliver one card per PR
and use `type(scope): summary (Pn-EE-CC)` for commits and PR titles.

- [Design and architecture](docs/DESIGN.md)
- [Roadmap and phase index](docs/ROADMAP.md)
- [Foundation cards](docs/roadmap/P0-foundation.md)
- [Build and TypeScript configuration](docs/build.md)
- [Testing guide](docs/testing.md)

## License

Motes' original code is source available under the
[PolyForm Noncommercial License 1.0.0](LICENSE)
(`PolyForm-Noncommercial-1.0.0`). Use, modification and redistribution are
subject to the permitted purposes and conditions of that license, including
its provisions for noncommercial organizations. It does not grant general
permission for commercial use.

The full license text governs over this summary. Third-party components
remain subject to their own licenses.
