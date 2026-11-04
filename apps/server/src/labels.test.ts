import { withTestDb } from '@motes/db/testing';
import { createPairingCode } from '@motes/domain';
import { apiErrorSchema, newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { createServices } from './composition.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const testDb = withTestDb();

async function setup() {
  const services = createServices(testDb.db);
  const app = createServer(testDb.db, createLogger('silent'), undefined, services);
  const code = await createPairingCode(services);
  const paired = await app.inject({
    method: 'POST',
    url: '/pair',
    payload: { code, name: 'Laptop' },
  });
  const headers = { authorization: `Bearer ${paired.json().token}` };
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  return { app, call };
}

let counter = 0;
async function newCard(call: Awaited<ReturnType<typeof setup>>['call']) {
  const key = `B${String.fromCharCode(65 + (counter % 26))}${String.fromCharCode(65 + Math.floor(counter / 26))}`;
  counter++;
  const project = (await call('POST', '/projects', { key, name: key })).json();
  const card = (await call('POST', `/projects/${project.id}/cards`, { title: 'x' })).json();
  return { project, card };
}

const errorCode = (response: { json: () => unknown }) => apiErrorSchema.parse(response.json()).code;

describe('label routes', () => {
  it('requires authentication', async () => {
    const { app } = await setup();
    for (const [method, url] of [
      ['GET', `/projects/${newId('project')}/labels`],
      ['POST', `/projects/${newId('project')}/labels`],
      ['PUT', `/cards/${newId('card')}/labels/${newId('label')}`],
      ['DELETE', `/cards/${newId('card')}/labels/${newId('label')}`],
    ] as const)
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    await app.close();
  });

  it('creates and lists the labels of a project in name order', async () => {
    const { app, call } = await setup();
    const { project } = await newCard(call);
    const bug = await call('POST', `/projects/${project.id}/labels`, {
      name: 'bug',
      color: '#d73a4a',
    });
    expect(bug.statusCode).toBe(201);
    expect(bug.json()).toMatchObject({ projectId: project.id, name: 'bug', color: '#d73a4a' });
    await call('POST', `/projects/${project.id}/labels`, { name: 'Api', color: '#0075ca' });
    const listed = await call('GET', `/projects/${project.id}/labels`);
    expect(listed.json().map((label: { name: string }) => label.name)).toEqual(['Api', 'bug']);
    expect(
      errorCode(
        await call('POST', `/projects/${project.id}/labels`, { name: 'BUG', color: '#000000' }),
      ),
    ).toBe('conflict');
    expect(
      errorCode(await call('POST', `/projects/${project.id}/labels`, { name: 'x', color: 'red' })),
    ).toBe('validation_failed');
    expect(
      (await call('POST', `/projects/${newId('project')}/labels`, { name: 'x', color: '#000000' }))
        .statusCode,
    ).toBe(404);
    await app.close();
  });

  it('attaches and detaches a label on a card, both idempotent', async () => {
    const { app, call } = await setup();
    const { project, card } = await newCard(call);
    const label = (
      await call('POST', `/projects/${project.id}/labels`, { name: 'bug', color: '#d73a4a' })
    ).json();
    const attached = await call('PUT', `/cards/${card.id}/labels/${label.id}`);
    expect(attached.statusCode).toBe(200);
    expect(attached.json().labels).toEqual([label.id]);
    expect((await call('PUT', `/cards/${card.id}/labels/${label.id}`)).json().labels).toEqual([
      label.id,
    ]);
    expect((await call('GET', `/cards/${card.id}`)).json().labels).toEqual([label.id]);
    expect((await call('DELETE', `/cards/${card.id}/labels/${label.id}`)).json().labels).toEqual(
      [],
    );
    expect((await call('DELETE', `/cards/${card.id}/labels/${label.id}`)).json().labels).toEqual(
      [],
    );
    await app.close();
  });

  it('refuses a label of another project and unknown ids', async () => {
    const { app, call } = await setup();
    const { card } = await newCard(call);
    const other = await newCard(call);
    const foreign = (
      await call('POST', `/projects/${other.project.id}/labels`, { name: 'bug', color: '#d73a4a' })
    ).json();
    expect(errorCode(await call('PUT', `/cards/${card.id}/labels/${foreign.id}`))).toBe(
      'validation_failed',
    );
    expect((await call('PUT', `/cards/${card.id}/labels/${newId('label')}`)).statusCode).toBe(404);
    expect((await call('PUT', `/cards/${newId('card')}/labels/${foreign.id}`)).statusCode).toBe(
      404,
    );
    await app.close();
  });
});
