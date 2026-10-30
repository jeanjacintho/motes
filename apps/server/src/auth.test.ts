import { withTestDb } from '@motes/db/testing';
import { createPairingCode } from '@motes/domain';
import type { FastifyRequest } from 'fastify';
import { expect, it } from 'vitest';
import { createServices } from './composition.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const testDb = withTestDb();

it('requires authentication and persists device revocation', async () => {
  const services = createServices(testDb.db);
  const app = createServer(
    testDb.db,
    createLogger('silent'),
    (server) => {
      server.get('/protected', async (request: FastifyRequest) => request.principal);
    },
    services,
  );
  expect((await app.inject({ url: '/protected' })).statusCode).toBe(401);
  expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
  const code = await createPairingCode(services);
  const paired = await app.inject({
    method: 'POST',
    url: '/pair',
    payload: { code, name: 'Laptop' },
  });
  expect(paired.statusCode).toBe(200);
  const headers = { authorization: `Bearer ${paired.json().token}` };
  const list = await app.inject({ url: '/devices', headers });
  expect(list.statusCode).toBe(200);
  const device = list.json()[0];
  expect(device.name).toBe('Laptop');
  expect((await app.inject({ url: '/protected', headers })).json()).toEqual({
    deviceId: device.id,
    kind: 'client',
  });
  expect(
    (await app.inject({ method: 'DELETE', url: `/devices/${device.id}`, headers })).statusCode,
  ).toBe(200);
  expect((await app.inject({ url: '/protected', headers })).statusCode).toBe(401);
  await app.close();
  const restarted = createServer(testDb.db, createLogger('silent'));
  expect((await restarted.inject({ url: '/devices', headers })).statusCode).toBe(401);
  await restarted.close();
});
