import { once } from 'node:events';
import { withTestDb } from '@motes/db/testing';
import { createPairingCode } from '@motes/domain';
import { apiErrorSchema, newId, runtimeTokenResponseSchema } from '@motes/protocol';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServices } from './composition.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const testDb = withTestDb();

async function setup() {
  const services = createServices(testDb.db);
  const app = createServer(
    testDb.db,
    createLogger('silent'),
    (server) => {
      // Stands in for the real daemon routes of the next cards.
      server.get('/daemon/whoami', async (request: FastifyRequest) => request.principal);
    },
    services,
  );
  const code = await createPairingCode(services);
  const paired = await app.inject({
    method: 'POST',
    url: '/pair',
    payload: { code, name: 'Laptop' },
  });
  const owner = { authorization: `Bearer ${paired.json().token}` };
  const mint = async (name = 'Máquina') => {
    const response = await app.inject({
      method: 'POST',
      url: '/runtimes/tokens',
      headers: owner,
      payload: { name },
    });
    return { response, minted: response.json() as { id: string; token: string } };
  };
  return { app, owner, mint };
}

describe('daemon tokens', () => {
  it('are minted by the owner and shown once', async () => {
    const { app, mint } = await setup();
    const { response, minted } = await mint('MacBook');
    expect(response.statusCode).toBe(201);
    expect(runtimeTokenResponseSchema.parse(minted)).toMatchObject({ name: 'MacBook' });
    await app.close();
  });

  it('need authentication and a name', async () => {
    const { app, owner } = await setup();
    expect(
      (await app.inject({ method: 'POST', url: '/runtimes/tokens', payload: { name: 'x' } }))
        .statusCode,
    ).toBe(401);
    for (const payload of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(81) }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/runtimes/tokens',
        headers: owner,
        payload,
      });
      expect(apiErrorSchema.parse(response.json()).code, JSON.stringify(payload)).toBe(
        'validation_failed',
      );
    }
    await app.close();
  });

  it('get 403 on every route outside /daemon, including minting more tokens', async () => {
    const { app, mint } = await setup();
    const { minted } = await mint();
    const headers = { authorization: `Bearer ${minted.token}` };
    for (const [method, url] of [
      ['GET', `/cards/${newId('card')}`],
      ['GET', '/projects'],
      ['GET', `/projects/${newId('project')}/board`],
      ['GET', '/bots'],
      ['GET', '/devices'],
      ['DELETE', `/devices/${minted.id}`],
      ['POST', '/runtimes/tokens'],
      ['GET', '/nowhere'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers,
        ...(method === 'POST' ? { payload: { name: 'x' } } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(apiErrorSchema.parse(response.json()).code).toBe('unauthorized');
    }
    // The 403 is the guard, not a side effect: nothing was revoked or created.
    expect((await app.inject({ url: '/daemon/whoami', headers })).statusCode).toBe(200);
    await app.close();
  });

  it('reach /daemon/*, as a daemon principal', async () => {
    const { app, mint } = await setup();
    const { minted } = await mint();
    const response = await app.inject({
      url: '/daemon/whoami?x=1',
      headers: { authorization: `Bearer ${minted.token}` },
    });
    expect(response.json()).toEqual({ deviceId: minted.id, kind: 'daemon' });
    await app.close();
  });

  it("are not accepted on /daemon/* from the owner's app", async () => {
    const { app, owner } = await setup();
    const response = await app.inject({ url: '/daemon/whoami', headers: owner });
    expect(response.statusCode).toBe(403);
    expect((await app.inject({ url: '/daemon/whoami' })).statusCode).toBe(401);
    await app.close();
  });

  it('can be revoked from the app, after which they get 401', async () => {
    const { app, owner, mint } = await setup();
    const { minted } = await mint();
    const headers = { authorization: `Bearer ${minted.token}` };
    expect((await app.inject({ url: '/daemon/whoami', headers })).statusCode).toBe(200);
    const listed = (await app.inject({ url: '/devices', headers: owner })).json() as {
      id: string;
      kind: string;
    }[];
    expect(listed.find((device) => device.id === minted.id)?.kind).toBe('daemon');
    expect(
      (await app.inject({ method: 'DELETE', url: `/devices/${minted.id}`, headers: owner }))
        .statusCode,
    ).toBe(200);
    expect((await app.inject({ url: '/daemon/whoami', headers })).statusCode).toBe(401);
    await app.close();
  });

  it('get no event stream: the websocket closes a daemon token like a bad one', async () => {
    const { app, mint } = await setup();
    const { minted } = await mint();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    await once(socket, 'open');
    socket.send(JSON.stringify({ token: minted.token }));
    const [code, reason] = await once(socket, 'close');
    expect(code).toBe(1008);
    expect(reason.toString()).toBe('Authentication required');
    expect(app.connections.size).toBe(0);
    await app.close();
  });
});
