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
    !connection.username ||
    !connection.password ||
    connection.pathname.length < 2
  )
    throw new Error('Invalid local database URL');
} catch {
  console.error('Set DATABASE_URL in .env to a local Postgres URL; see .env.example.');
  process.exit(1);
}

const args =
  command === 'up'
    ? ['up', '--detach', '--no-recreate', '--wait', '--wait-timeout', '60', 'postgres']
    : command === 'reset'
      ? ['down', '--volumes']
      : ['down'];
const port = connection.port || '5432';
const composeArgs = [
  'compose',
  '--project-name',
  port === '5432' ? 'motes' : `motes-${port}`,
  '--file',
  fileURLToPath(new URL('../docker-compose.yml', import.meta.url)),
];
const env = {
  ...process.env,
  POSTGRES_USER: decodeURIComponent(connection.username),
  POSTGRES_PASSWORD: decodeURIComponent(connection.password),
  POSTGRES_DB: decodeURIComponent(connection.pathname.slice(1)),
  POSTGRES_PORT: port,
  PGUSER: decodeURIComponent(connection.username),
  PGPASSWORD: decodeURIComponent(connection.password),
  PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
};
const result = spawnSync('docker', [...composeArgs, ...args], {
  stdio: 'inherit',
  env,
});
if (result.error) console.error('Could not run Docker. Install Docker with the Compose plugin.');
if (result.status !== 0) process.exit(result.status ?? 1);
if (command === 'up') {
  const verify = spawnSync(
    'docker',
    [
      ...composeArgs,
      'exec',
      '-T',
      '-e',
      'PGUSER',
      '-e',
      'PGPASSWORD',
      '-e',
      'PGDATABASE',
      'postgres',
      'psql',
      '-h',
      '127.0.0.1',
      '-c',
      'SELECT 1',
    ],
    { env, stdio: 'ignore' },
  );
  if (verify.status !== 0) {
    console.error(
      'Postgres authentication failed for DATABASE_URL. Existing volumes retain their original credentials; use the original connection or an isolated local port.',
    );
    process.exit(1);
  }
}
