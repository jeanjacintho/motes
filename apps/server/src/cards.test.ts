import { withTestDb } from '@motes/db/testing';
import { createPairingCode } from '@motes/domain';
import { apiErrorSchema, boardSchema, newId, timelinePageSchema } from '@motes/protocol';
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
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  return { app, call };
}

let counter = 0;
async function newProject(call: Awaited<ReturnType<typeof setup>>['call']) {
  const key = `K${String.fromCharCode(65 + (counter % 26))}${String.fromCharCode(65 + Math.floor(counter / 26))}`;
  counter++;
  return (await call('POST', '/projects', { key, name: key })).json();
}

const errorCode = (response: { json: () => unknown }) => apiErrorSchema.parse(response.json()).code;

describe('card routes', () => {
  it('requires authentication', async () => {
    const { app } = await setup();
    for (const [method, url] of [
      ['POST', `/projects/${newId('project')}/cards`],
      ['GET', `/cards/${newId('card')}`],
      ['PATCH', `/cards/${newId('card')}`],
      ['POST', `/cards/${newId('card')}/move`],
      ['POST', `/cards/${newId('card')}/assign`],
      ['GET', `/projects/${newId('project')}/board`],
      ['GET', `/cards/${newId('card')}/timeline`],
      ['POST', `/cards/${newId('card')}/comments`],
      ['PATCH', `/comments/${newId('comment')}`],
      ['DELETE', `/comments/${newId('comment')}`],
    ] as const)
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    await app.close();
  });

  it('creates a card and reads it by id and by KEY-number', async () => {
    const { app, call } = await setup();
    const project = await newProject(call);
    const created = await call('POST', `/projects/${project.id}/cards`, {
      title: 'Corrigir typo',
      priority: 'high',
    });
    expect(created.statusCode).toBe(201);
    const card = created.json();
    expect(card).toMatchObject({
      number: 1,
      status: 'backlog',
      priority: 'high',
      labels: [],
      createdBy: { type: 'owner', id: 'owner' },
    });
    expect((await call('GET', `/cards/${card.id}`)).json()).toEqual(card);
    expect((await call('GET', `/cards/${project.key}-1`)).json()).toEqual(card);
    expect(errorCode(await call('GET', `/cards/${project.key}-2`))).toBe('not_found');
    expect((await call('GET', `/cards/${newId('card')}`)).statusCode).toBe(404);
    expect((await call('GET', '/cards/garbage')).statusCode).toBe(404);
    const invalid = await call('POST', `/projects/${project.id}/cards`, { title: ' ' });
    expect(invalid.statusCode).toBe(400);
    expect(errorCode(invalid)).toBe('validation_failed');
    expect(
      (await call('POST', `/projects/${newId('project')}/cards`, { title: 'x' })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('updates a card and maps domain errors to the protocol codes', async () => {
    const { app, call } = await setup();
    const project = await newProject(call);
    const other = await newProject(call);
    const foreign = (
      await call('POST', `/projects/${other.id}/repositories`, {
        name: 'api',
        remoteUrl: 'git@example.com:o/api.git',
        defaultBranch: 'main',
      })
    ).json();
    const card = (await call('POST', `/projects/${project.id}/cards`, { title: 'Antes' })).json();
    const updated = await call('PATCH', `/cards/${card.id}`, { title: 'Depois', priority: 'low' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ title: 'Depois', priority: 'low' });
    expect((await call('PATCH', `/cards/${card.id}`, { title: '' })).statusCode).toBe(400);
    const wrongRepository = await call('PATCH', `/cards/${card.id}`, { repositoryId: foreign.id });
    expect(wrongRepository.statusCode).toBe(400);
    expect(errorCode(wrongRepository)).toBe('validation_failed');
    expect((await call('PATCH', `/cards/${newId('card')}`, { title: 'x' })).statusCode).toBe(404);
    await app.close();
  });

  it('assigns the owner, refuses unknown bots and clears the assignment', async () => {
    const { app, call } = await setup();
    const project = await newProject(call);
    const card = (await call('POST', `/projects/${project.id}/cards`, { title: 'x' })).json();
    const owner = await call('POST', `/cards/${card.id}/assign`, {
      assignee: { type: 'owner', id: 'owner' },
    });
    expect(owner.json().assignee).toEqual({ type: 'owner', id: 'owner' });
    const bot = await call('POST', `/cards/${card.id}/assign`, {
      assignee: { type: 'bot', id: newId('bot') },
    });
    expect(bot.statusCode).toBe(404);
    expect(errorCode(bot)).toBe('not_found');
    const cleared = await call('POST', `/cards/${card.id}/assign`, { assignee: null });
    expect(cleared.json().assignee).toBeUndefined();
    expect((await call('POST', `/cards/${card.id}/assign`, {})).statusCode).toBe(400);
    await app.close();
  });

  it('moves a card between columns and inside one, with the status rules', async () => {
    const { app, call } = await setup();
    const project = await newProject(call);
    const make = async (title: string) =>
      (await call('POST', `/projects/${project.id}/cards`, { title })).json();
    const [a, b, c] = [await make('a'), await make('b'), await make('c')];
    const moved = await call('POST', `/cards/${c.id}/move`, { status: 'todo' });
    expect(moved.json().status).toBe('todo');
    const reordered = await call('POST', `/cards/${b.id}/move`, {
      status: 'backlog',
      beforeId: a.id,
    });
    expect(reordered.statusCode).toBe(200);
    const board = boardSchema.parse((await call('GET', `/projects/${project.id}/board`)).json());
    expect(
      board.columns.find((column) => column.status === 'backlog')?.cards.map((x) => x.title),
    ).toEqual(['b', 'a']);
    const forbidden = await call('POST', `/cards/${a.id}/move`, { status: 'done' });
    expect(forbidden.statusCode).toBe(409);
    expect(errorCode(forbidden)).toBe('conflict');
    const stale = await call('POST', `/cards/${c.id}/move`, {
      status: 'backlog',
      afterId: b.id,
      beforeId: newId('card'),
    });
    expect(stale.statusCode).toBe(400);
    expect((await call('POST', `/cards/${a.id}/move`, { status: 'started' })).statusCode).toBe(400);
    expect(
      (await call('POST', `/cards/${newId('card')}/move`, { status: 'todo' })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('returns the board with every column and applies the query filters', async () => {
    const { app, call } = await setup();
    const project = await newProject(call);
    const high = (
      await call('POST', `/projects/${project.id}/cards`, {
        title: 'Login quebrado',
        priority: 'high',
      })
    ).json();
    await call('POST', `/projects/${project.id}/cards`, { title: 'Typo' });
    const everything = await call('GET', `/projects/${project.id}/board`);
    expect(everything.statusCode).toBe(200);
    expect(boardSchema.parse(everything.json()).columns).toHaveLength(7);
    const titles = async (query: string) =>
      boardSchema
        .parse((await call('GET', `/projects/${project.id}/board?${query}`)).json())
        .columns.flatMap((column) => column.cards.map((card) => card.id));
    expect(await titles('priority=high')).toEqual([high.id]);
    expect(await titles('text=login&priority=high')).toEqual([high.id]);
    expect(await titles('text=login&priority=low')).toEqual([]);
    expect(await titles('assignee=owner:owner')).toEqual([]);
    expect((await call('GET', `/projects/${project.id}/board?priority=critical`)).statusCode).toBe(
      400,
    );
    expect((await call('GET', `/projects/${project.id}/board?assignee=robot:x`)).statusCode).toBe(
      400,
    );
    expect((await call('GET', `/projects/${newId('project')}/board`)).statusCode).toBe(404);
    await app.close();
  });

  describe('timeline', () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

    it('comments, edits and deletes through the routes and lists it all in order', async () => {
      const { app, call } = await setup();
      const project = await newProject(call);
      const card = (await call('POST', `/projects/${project.id}/cards`, { title: 'Um' })).json();
      await pause();
      const first = await call('POST', `/cards/${card.id}/comments`, { body: 'primeiro' });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ cardId: card.id, author: { type: 'owner' } });
      await pause();
      await call('PATCH', `/cards/${card.id}`, { title: 'Dois' });
      await pause();
      const second = (await call('POST', `/cards/${card.id}/comments`, { body: 'segundo' })).json();
      const edited = await call('PATCH', `/comments/${second.id}`, { body: 'segundo, editado' });
      expect(edited.json()).toMatchObject({
        body: 'segundo, editado',
        editedAt: expect.any(String),
      });
      await pause();
      const third = (await call('POST', `/cards/${card.id}/comments`, { body: 'terceiro' })).json();
      expect((await call('DELETE', `/comments/${third.id}`)).json()).toEqual({ deleted: true });

      const page = timelinePageSchema.parse(
        (await call('GET', `/cards/${card.id}/timeline`)).json(),
      );
      expect(
        page.items.map((item) => (item.kind === 'comment' ? item.comment.body : item.entry.type)),
      ).toEqual(['card.created', 'primeiro', 'card.updated', 'segundo, editado']);
      expect(page.nextCursor).toBeNull();
      await app.close();
    });

    it('pages with a cursor and validates the query', async () => {
      const { app, call } = await setup();
      const project = await newProject(call);
      const card = (await call('POST', `/projects/${project.id}/cards`, { title: 'Um' })).json();
      for (const body of ['a', 'b', 'c']) {
        await pause();
        await call('POST', `/cards/${card.id}/comments`, { body });
      }
      const first = timelinePageSchema.parse(
        (await call('GET', `/cards/${card.id}/timeline?limit=3`)).json(),
      );
      expect(first.items).toHaveLength(3);
      expect(first.nextCursor).not.toBeNull();
      const second = timelinePageSchema.parse(
        (
          await call(
            'GET',
            `/cards/${card.id}/timeline?limit=3&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
          )
        ).json(),
      );
      expect(second.items.map((item) => item.kind)).toEqual(['comment']);
      expect(second.nextCursor).toBeNull();
      for (const query of ['limit=0', 'limit=101', 'limit=x', 'cursor=garbage'])
        expect(errorCode(await call('GET', `/cards/${card.id}/timeline?${query}`)), query).toBe(
          'validation_failed',
        );
      expect((await call('GET', `/cards/${newId('card')}/timeline`)).statusCode).toBe(404);
      await app.close();
    });

    it('rejects blank comments and unknown ids', async () => {
      const { app, call } = await setup();
      const project = await newProject(call);
      const card = (await call('POST', `/projects/${project.id}/cards`, { title: 'Um' })).json();
      expect(errorCode(await call('POST', `/cards/${card.id}/comments`, { body: '   ' }))).toBe(
        'validation_failed',
      );
      expect(
        (await call('POST', `/cards/${newId('card')}/comments`, { body: 'x' })).statusCode,
      ).toBe(404);
      expect((await call('PATCH', `/comments/${newId('comment')}`, { body: 'x' })).statusCode).toBe(
        404,
      );
      expect((await call('DELETE', `/comments/${newId('comment')}`)).statusCode).toBe(404);
      await app.close();
    });
  });
});
