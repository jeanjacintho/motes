import { withTestDb } from '@motes/db/testing';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const testDb = withTestDb();

describe('health', () => {
  it('reports version, uptime, database availability and migrations', async () => {
    const server = createServer(testDb.db, createLogger('silent'));
    const response = await server.inject('/health');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      version: expect.any(String),
      uptime: expect.any(Number),
      database: true,
      migrations: true,
    });
    await server.close();
  });

  it('reports pending migrations', async () => {
    const records = await testDb.db.$client<
      { name: string; checksum: string }[]
    >`SELECT name, checksum FROM schema_migrations`;
    await testDb.db.$client`UPDATE schema_migrations SET checksum = 'invalid'`;
    const server = createServer(testDb.db, createLogger('silent'));
    const response = await server.inject('/health');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ database: true, migrations: false });
    await server.close();
    for (const record of records)
      await testDb.db
        .$client`UPDATE schema_migrations SET checksum = ${record.checksum} WHERE name = ${record.name}`;
  });

  it('drains an active keep-alive request and exits on SIGTERM', async () => {
    const socket = createNetServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      socket.close((error) => (error ? reject(error) : resolve())),
    );
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
    databaseUrl.pathname = `/${testDb.name}`;
    const child = spawn(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL('./index.ts', import.meta.url)),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl.toString(),
          MOTES_PORT: String(port),
          LOG_LEVEL: 'silent',
        },
        stdio: 'ignore',
      },
    );
    const exited = once(child, 'exit');
    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          response = await fetch(`http://127.0.0.1:${port}/health`);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(response?.status).toBe(200);
      await response?.text();
      let pending: Promise<Response> | undefined;
      let start = 0;
      await testDb.db.$client.begin(async (tx) => {
        await tx`LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE`;
        pending = fetch(`http://127.0.0.1:${port}/health`);
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await testDb.db.$client<{ blocked: boolean }[]>`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND query LIKE '%SELECT name, checksum FROM schema_migrations ORDER BY name%'
            ) AS blocked`;
          if (rows[0]?.blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(blocked).toBe(true);
        start = performance.now();
        child.kill('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(pending).toBeDefined();
      const drained = await pending;
      expect(drained?.status).toBe(200);
      expect(await drained?.json()).toMatchObject({ database: true, migrations: true });
      const [code, signal] = await exited;
      expect(code).toBe(0);
      expect(signal).toBeNull();
      expect(performance.now() - start).toBeLessThan(5000);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  }, 15000);
});

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
