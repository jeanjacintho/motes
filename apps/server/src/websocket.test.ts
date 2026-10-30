import { once } from 'node:events';
import { withTestDb } from '@motes/db/testing';
import { createPairingCode } from '@motes/domain';
import { expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServices } from './composition.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const testDb = withTestDb();

it('authenticates the first message and removes unresponsive connections', async () => {
  const services = createServices(testDb.db);
  const app = createServer(testDb.db, createLogger('silent'), undefined, services);
  const code = await createPairingCode(services);
  const paired = await app.inject({
    method: 'POST',
    url: '/pair',
    payload: { code, name: 'Laptop' },
  });
  const token: string = paired.json().token;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const bad = new WebSocket(url);
  await once(bad, 'open');
  bad.send(JSON.stringify({ token: 'invalid' }));
  const [closeCode, reason] = await once(bad, 'close');
  expect(closeCode).toBe(1008);
  expect(reason.toString()).toBe('Authentication required');
  const good = new WebSocket(url, { autoPong: false });
  await once(good, 'open');
  good.send(JSON.stringify({ token }));
  await once(good, 'ping');
  expect(app.connections.size).toBe(1);
  await once(good, 'close');
  await expect.poll(() => app.connections.size).toBe(0);
  await app.close();
}, 50000);

it('closes promptly with responsive and paused authenticated and unauthenticated sockets', async () => {
  const services = createServices(testDb.db);
  const app = createServer(testDb.db, createLogger('silent'), undefined, services);
  const code = await createPairingCode(services);
  const paired = await app.inject({
    method: 'POST',
    url: '/pair',
    payload: { code, name: 'Laptop' },
  });
  const token: string = paired.json().token;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const sockets = Array.from({ length: 4 }, () => new WebSocket(url));
  try {
    await Promise.all(sockets.map((socket) => once(socket, 'open')));
    for (const socket of sockets.slice(0, 2)) socket.send(JSON.stringify({ token }));
    await expect.poll(() => [...app.connections.values()][0]?.size).toBe(2);
    sockets[0]?.pause();
    sockets[2]?.pause();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        app.close(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Shutdown exceeded 4900ms')), 4900);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    expect(app.connections.size).toBe(0);
  } finally {
    for (const socket of sockets) {
      socket.resume();
      socket.terminate();
    }
    await app.close();
  }
}, 10000);
