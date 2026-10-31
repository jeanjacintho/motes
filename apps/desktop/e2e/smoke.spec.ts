import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test';
import postgres from 'postgres';

const run = promisify(execFile);
const desktopDir = fileURLToPath(new URL('..', import.meta.url));
const serverDir = fileURLToPath(new URL('../../server', import.meta.url));
const tsx = `${serverDir}/node_modules/.bin/tsx`;
const setupCode = /Setup code: ([A-Z2-9]{8})/;

let admin: postgres.Sql;
let databaseName = '';
let server: ChildProcess | undefined;
let app: ElectronApplication | undefined;
let serverLog = '';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${name}`;
  return url.href;
}

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to a local Postgres instance.');
  admin = postgres(databaseUrl('postgres'), { max: 1 });
  databaseName = `motes_e2e_${randomBytes(6).toString('hex')}`;
  await admin.unsafe(`CREATE DATABASE ${databaseName}`);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server?.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
  await admin?.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin?.end();
});

test('pairs the desktop app and counts a live event', async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl(databaseName),
    MOTES_PORT: String(port),
    MOTES_DEV_ROUTES: 'true',
    MOTES_REPLAY_LIMIT: '5000',
  };

  server = spawn(tsx, ['src/index.ts'], { cwd: serverDir, env: serverEnv });
  const firstCode = new Promise<string>((resolve, reject) => {
    const capture = (chunk: Buffer) => {
      serverLog += chunk.toString();
      const match = setupCode.exec(serverLog);
      if (match?.[1]) resolve(match[1]);
    };
    server?.stdout?.on('data', capture);
    server?.stderr?.on('data', capture);
    server?.once('exit', () => reject(new Error(`Server exited early:\n${serverLog}`)));
  });
  const code = await firstCode;
  await expect
    .poll(async () => (await fetch(`${baseUrl}/health`).catch(() => null))?.status, {
      message: `server health\n${serverLog}`,
      timeout: 30_000,
    })
    .toBe(200);

  app = await electron.launch({
    args: ['.', ...(process.env.CI ? ['--no-sandbox'] : [])],
    cwd: desktopDir,
    env: { ...process.env, MOTES_E2E_MEMORY_STORAGE: '1' } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.getByLabel('URL do servidor').fill(baseUrl);
  await page.getByLabel('Nome do dispositivo').fill('Playwright');
  await page.getByLabel('Código de configuração').fill(code);
  await page.getByRole('button', { name: 'Parear' }).click();

  await expect(page.getByText('Conectado', { exact: true })).toBeVisible({ timeout: 15_000 });
  const counter = page.getByTestId('event-count');
  await expect(counter).toHaveText('0');

  // A second device emits the event: issue a fresh setup code and pair it over HTTP.
  const issued = await run(tsx, ['src/index.ts', 'pair'], { cwd: serverDir, env: serverEnv });
  const secondCode = setupCode.exec(issued.stdout)?.[1];
  if (!secondCode) throw new Error(`No setup code issued:\n${issued.stdout}`);
  const paired = await fetch(`${baseUrl}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: secondCode, name: 'Emitter' }),
  });
  const { token } = (await paired.json()) as { token: string };

  // The socket reports "connected" when it opens, slightly before the server starts
  // streaming, so keep pinging until one event lands.
  await expect(async () => {
    const response = await fetch(`${baseUrl}/dev/ping`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    await expect(counter).not.toHaveText('0', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
});
