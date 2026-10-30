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

  it('terminates on SIGTERM within five seconds', async () => {
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
      const start = performance.now();
      child.kill('SIGTERM');
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
