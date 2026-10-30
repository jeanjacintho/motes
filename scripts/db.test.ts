import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const script = fileURLToPath(new URL('./db.ts', import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'motes-db-'));
  roots.push(root);
  const log = join(root, 'calls.jsonl');
  writeFileSync(
    join(root, 'docker'),
    `#!${process.execPath}
require('node:fs').appendFileSync(process.env.CALL_LOG, JSON.stringify({args: process.argv.slice(2), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB}) + '\\n');
process.exit(Number(process.env.DOCKER_EXIT ?? 0));
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, '.env'),
    'DATABASE_URL=postgresql://local:fixture%2Dpassword@localhost:5432/local_db\n',
  );
  function run(args: string[], extra: Record<string, string> = {}) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      CALL_LOG: log,
      ...extra,
    };
    delete env.DATABASE_URL;
    return spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: 'utf8' });
  }
  return {
    contactedDocker: () => existsSync(log),
    run,
    calls: () =>
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
  };
}

test('reset refuses before invoking Docker unless the exact confirmation flag is provided', () => {
  const { run, contactedDocker } = fixture();
  for (const args of [['reset'], ['reset', '--yes'], ['reset', '--confirm', 'extra']]) {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--confirm');
    expect(contactedDocker()).toBe(false);
  }
});

test('up waits for health and reads connection settings from .env without logging credentials', () => {
  const { run, calls } = fixture();
  const result = run(['up']);
  expect(result.status).toBe(0);
  expect(calls()).toEqual([
    {
      args: [
        'compose',
        '--file',
        expect.stringContaining('docker-compose.yml'),
        'up',
        '--detach',
        '--wait',
        '--wait-timeout',
        '60',
        'postgres',
      ],
      user: 'local',
      password: 'fixture-password',
      database: 'local_db',
    },
  ]);
  expect(result.stdout + result.stderr).not.toContain('fixture-password');
});

test('down preserves volumes; confirmed reset removes them without restarting', () => {
  const { run, calls } = fixture();
  expect(run(['down']).status).toBe(0);
  expect(run(['reset', '--confirm']).status).toBe(0);
  expect(calls().map((call) => call.args.slice(3))).toEqual([['down'], ['down', '--volumes']]);
});

test('Docker failures propagate to the caller', () => {
  const { run } = fixture();
  expect(run(['up'], { DOCKER_EXIT: '17' }).status).toBe(17);
});
