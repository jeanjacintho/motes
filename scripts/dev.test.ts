import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const script = fileURLToPath(new URL('./dev.ts', import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// The fake pnpm records each started command; the one named by HANG waits for SIGTERM.
function run(exits: Record<string, number>) {
  const root = mkdtempSync(join(tmpdir(), 'motes-dev-'));
  roots.push(root);
  writeFileSync(
    join(root, 'pnpm'),
    `#!${process.execPath}
const fs = require('node:fs');
const name = process.argv[2];
fs.appendFileSync(process.env.LOG, 'start ' + name + '\\n');
const exits = JSON.parse(process.env.EXITS);
if (name in exits) setTimeout(() => process.exit(exits[name]), 300);
else {
  process.on('SIGTERM', () => { fs.appendFileSync(process.env.LOG, 'stop ' + name + '\\n'); process.exit(0); });
  setInterval(() => {}, 1000);
}
`,
    { mode: 0o755 },
  );
  const log = join(root, 'log');
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      LOG: log,
      EXITS: JSON.stringify(exits),
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  return { result, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

test('stops the server when the desktop exits and returns its exit code', () => {
  const { result, log } = run({ 'dev:desktop': 3 });
  expect(result.status).toBe(3);
  expect(log).toContain('start dev:server');
  expect(log).toContain('start dev:desktop');
  expect(log).toContain('stop dev:server');
});

test('stops the desktop when the server exits', () => {
  const { result, log } = run({ 'dev:server': 1 });
  expect(result.status).toBe(1);
  expect(log).toContain('stop dev:desktop');
});
