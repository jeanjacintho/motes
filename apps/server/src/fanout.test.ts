import { once } from 'node:events';
import { withTestDb } from '@motes/db/testing';
import { createPairingCode } from '@motes/domain';
import { expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServices } from './composition.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const testDb = withTestDb();

it('replays missed events in order, streams new events and requires resync past the limit', async () => {
  const services = createServices(testDb.db);
  const app = createServer(testDb.db, createLogger('silent'), undefined, services, {
    replayLimit: 3,
    devRoutes: true,
  });
  const code = await createPairingCode(services);
  const pair = await app.inject({
    method: 'POST',
    url: '/pair',
    payload: { code, name: 'Laptop' },
  });
  const token: string = pair.json().token;
  const headers = { authorization: `Bearer ${token}` };
  for (let i = 0; i < 3; i++) {
    const response = await app.inject({ method: 'POST', url: '/dev/ping', headers });
    expect(response.statusCode).toBe(200);
  }
  const rows = await testDb.db.$client<
    { seq: string }[]
  >`SELECT seq FROM events WHERE type = 'system.ping' ORDER BY seq`;
  const cursorRows = await testDb.db.$client<
    { seq: string }[]
  >`SELECT seq FROM events WHERE seq < ${rows[0]?.seq ?? '0'} ORDER BY seq DESC LIMIT 1`;
  const cursor = cursorRows[0]?.seq ?? '0';
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const connect = async (resumeAfter: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    await once(socket, 'open');
    const messages: unknown[] = [];
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      // Readiness is covered in websocket.test.ts; these tests follow events only.
      if (message.type !== 'ready') messages.push(message);
    });
    socket.send(JSON.stringify({ token, resumeAfter }));
    return { socket, messages };
  };
  const client = await connect(cursor);
  try {
    await expect.poll(() => client.messages.length).toBe(3);
    expect(client.messages.map((message) => (message as { seq: string }).seq)).toEqual(
      rows.map((row) => row.seq),
    );
    await app.inject({ method: 'POST', url: '/dev/ping', headers });
    await expect.poll(() => client.messages.length).toBe(4);
    expect(client.messages[3]).toMatchObject({ event: { type: 'system.ping' } });
    const stale = await connect(cursor);
    try {
      await expect.poll(() => stale.messages.length).toBe(1);
      expect(stale.messages[0]).toEqual({ type: 'resync_required' });
    } finally {
      stale.socket.terminate();
    }
  } finally {
    client.socket.terminate();
    await app.close();
  }
});
