import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import {
  getCardById,
  getCardByRef,
  insertCard,
  type NewCard,
  repositoryHasCards,
} from './cards.js';
import { cards, projects, repositories } from './schema.js';
import { withTestDb } from './testing.js';

const testDb = withTestDb();
const now = new Date('2026-10-31T10:00:00.000Z');

async function project(key: string) {
  const id = newId('project');
  await testDb.db.insert(projects).values({ id, key, name: key, description: '', createdAt: now });
  return id;
}

function newCard(projectId: string, overrides: Partial<NewCard> = {}): NewCard {
  return {
    id: newId('card'),
    projectId,
    title: 'Corrigir typo',
    createdBy: { type: 'owner', id: 'owner' },
    now,
    ...overrides,
  };
}

const insert = (card: NewCard) => testDb.db.transaction((tx) => insertCard(tx, card));

describe('card numbering', () => {
  it('gives 20 concurrent inserts in one project the numbers 1 to 20 without gaps', async () => {
    const id = await project('CON');
    const created = await Promise.all(Array.from({ length: 20 }, () => insert(newCard(id))));
    expect(created.map((card) => card.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });

  it('numbers each project on its own and does not consume a number on rollback', async () => {
    const one = await project('ONE');
    const two = await project('TWO');
    expect((await insert(newCard(one))).number).toBe(1);
    expect((await insert(newCard(two))).number).toBe(1);
    await expect(
      testDb.db.transaction(async (tx) => {
        await insertCard(tx, newCard(one));
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect((await insert(newCard(one))).number).toBe(2);
  });
});

describe('card storage', () => {
  it('stores defaults, assignee and repository, and finds the card by id and by reference', async () => {
    const id = await project('FND');
    const repositoryId = newId('repository');
    await testDb.db.insert(repositories).values({
      id: repositoryId,
      projectId: id,
      name: 'api',
      remoteUrl: 'git@x:o/api.git',
      defaultBranch: 'main',
      isPrimary: true,
      createdAt: now,
    });
    const botId = newId('bot');
    const created = await insert(
      newCard(id, { assignee: { type: 'bot', id: botId }, repositoryId, priority: 'high' }),
    );
    expect(created).toMatchObject({
      number: 1,
      status: 'backlog',
      priority: 'high',
      description: '',
      labels: [],
      assignee: { type: 'bot', id: botId },
      repositoryId,
      createdBy: { type: 'owner', id: 'owner' },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    expect(await getCardById(testDb.db, created.id)).toEqual(created);
    expect(await getCardByRef(testDb.db, 'FND-1')).toEqual(created);
    expect(await getCardByRef(testDb.db, 'FND-2')).toBeUndefined();
    expect(await getCardByRef(testDb.db, 'NOP-1')).toBeUndefined();
    expect(await getCardByRef(testDb.db, 'fnd-1')).toBeUndefined();
    expect(await getCardById(testDb.db, newId('card'))).toBeUndefined();
  });

  it('omits the assignee and repository when there are none', async () => {
    const id = await project('OMT');
    const created = await insert(newCard(id));
    expect(created.assignee).toBeUndefined();
    expect(created.repositoryId).toBeUndefined();
  });

  it('rejects rows the domain should never write', async () => {
    const id = await project('BAD');
    const row = {
      id: newId('card'),
      projectId: id,
      number: 1,
      title: 'x',
      description: '',
      status: 'backlog',
      priority: 'none',
      createdByType: 'owner',
      createdById: 'owner',
      createdAt: now,
      updatedAt: now,
    };
    const rejects = (overrides: Record<string, unknown>) =>
      expect(
        testDb.db.insert(cards).values({ ...row, id: newId('card'), ...overrides } as never),
      ).rejects.toThrow();
    await rejects({ status: 'started' });
    await rejects({ priority: 'critical' });
    await rejects({ number: 0 });
    await rejects({ title: '   ' });
    await rejects({ assigneeType: 'bot' });
    await rejects({ assigneeId: 'x' });
    await rejects({ assigneeType: 'robot', assigneeId: 'x' });
    await rejects({ repositoryId: newId('repository') });
    await rejects({ projectId: newId('project') });
    await testDb.db.insert(cards).values(row as never);
    await rejects({});
  });
});

describe('repository usage', () => {
  it('reports whether any card, open or closed, references a repository', async () => {
    const id = await project('USE');
    const repositoryId = newId('repository');
    await testDb.db.insert(repositories).values({
      id: repositoryId,
      projectId: id,
      name: 'api',
      remoteUrl: 'git@x:o/api.git',
      defaultBranch: 'main',
      isPrimary: true,
      createdAt: now,
    });
    expect(await repositoryHasCards(testDb.db, repositoryId)).toBe(false);
    await insert(newCard(id));
    expect(await repositoryHasCards(testDb.db, repositoryId)).toBe(false);
    await insert(newCard(id, { repositoryId, status: 'done' }));
    expect(await repositoryHasCards(testDb.db, repositoryId)).toBe(true);
  });
});
