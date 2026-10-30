import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const [command, ...flags] = process.argv.slice(2);
if (
  !['up', 'down', 'reset'].includes(command ?? '') ||
  (command === 'reset' ? flags.length !== 1 || flags[0] !== '--confirm' : flags.length !== 0)
) {
  console.error('Usage: pnpm db:up | pnpm db:down | pnpm db:reset --confirm (deletes local data)');
  process.exit(1);
}

try {
  loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}

let connection: URL;
try {
  connection = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(connection.protocol) ||
    !['localhost', '127.0.0.1'].includes(connection.hostname) ||
    (connection.port !== '' && connection.port !== '5432') ||
    !connection.username ||
    !connection.password ||
    connection.pathname.length < 2
  )
    throw new Error('Invalid local database URL');
} catch {
  console.error('Set DATABASE_URL in .env to a local Postgres URL on port 5432; see .env.example.');
  process.exit(1);
}

const args =
  command === 'up'
    ? ['up', '--detach', '--wait', '--wait-timeout', '60', 'postgres']
    : command === 'reset'
      ? ['down', '--volumes']
      : ['down'];
const result = spawnSync(
  'docker',
  ['compose', '--file', fileURLToPath(new URL('../docker-compose.yml', import.meta.url)), ...args],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      POSTGRES_USER: decodeURIComponent(connection.username),
      POSTGRES_PASSWORD: decodeURIComponent(connection.password),
      POSTGRES_DB: decodeURIComponent(connection.pathname.slice(1)),
    },
  },
);
if (result.error) console.error('Could not run Docker. Install Docker with the Compose plugin.');
process.exit(result.status ?? 1);
