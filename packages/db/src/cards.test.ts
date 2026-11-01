import { newId } from '@motes/protocol';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  cardLabelIds,
  getCardById,
  getCardByRef,
  insertCard,
  lastPosition,
  listBoardCards,
  type NewCard,
  repositoryHasCards,
} from './cards.js';
import { cardLabels, cards, labels, projects, repositories } from './schema.js';
import { withTestDb } from './testing.js';

const testDb = withTestDb();
const now = new Date('2026-10-31T10:00:00.000Z');

async function project(key: string) {
  const id = newId('project');
  await testDb.db.insert(projects).values({ id, key, name: key, description: '', createdAt: now });
  return id;
}

let positions = 0;
function newCard(projectId: string, overrides: Partial<NewCard> = {}): NewCard {
  return {
    position: `a${String(++positions).padStart(6, '0')}1`,
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
    // Numbers beyond the integer column cannot exist; they must read as missing, not throw.
    expect(await getCardByRef(testDb.db, 'FND-2147483647')).toBeUndefined();
    expect(await getCardByRef(testDb.db, 'FND-2147483648')).toBeUndefined();
    expect(await getCardByRef(testDb.db, 'NOP-2147483648')).toBeUndefined();
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
      position: 'V',
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
    await rejects({ position: '' });
    await rejects({ position: 'a0' });
    await rejects({ position: 'a b' });
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

describe('soft deleted cards', () => {
  it('read as missing, keep their number, and still hold their repository', async () => {
    const id = await project('DEL');
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
    const created = await insert(newCard(id, { repositoryId }));
    await testDb.db.update(cards).set({ deletedAt: now }).where(eq(cards.id, created.id));
    expect(await getCardById(testDb.db, created.id)).toBeUndefined();
    expect(await getCardByRef(testDb.db, 'DEL-1')).toBeUndefined();
    expect(await repositoryHasCards(testDb.db, repositoryId)).toBe(true);
    expect((await insert(newCard(id))).number).toBe(2);
  });
});

describe('card labels', () => {
  it('reads label ids in name order on lookups and keeps names unique per project ignoring case', async () => {
    const id = await project('LAB');
    const other = await project('LAC');
    const card = await insert(newCard(id));
    const row = (projectId: string, name: string) => ({
      id: newId('label'),
      projectId,
      name,
      color: '#d73a4a',
      createdAt: now,
    });
    const zeta = row(id, 'zeta');
    const alpha = row(id, 'Alpha');
    await testDb.db.insert(labels).values([zeta, alpha]);
    await testDb.db.insert(cardLabels).values([
      { cardId: card.id, labelId: zeta.id },
      { cardId: card.id, labelId: alpha.id },
    ]);
    expect(await cardLabelIds(testDb.db, card.id)).toEqual([alpha.id, zeta.id]);
    expect((await getCardById(testDb.db, card.id))?.labels).toEqual([alpha.id, zeta.id]);
    expect((await getCardByRef(testDb.db, 'LAB-1'))?.labels).toEqual([alpha.id, zeta.id]);
    await expect(testDb.db.insert(labels).values(row(id, 'ALPHA'))).rejects.toThrow();
    await testDb.db.insert(labels).values(row(other, 'alpha'));
    await expect(
      testDb.db.insert(labels).values({ ...row(id, 'bad'), color: 'red' }),
    ).rejects.toThrow();
    await expect(
      testDb.db.insert(cardLabels).values({ cardId: card.id, labelId: zeta.id }),
    ).rejects.toThrow();
  });
});

describe('column positions', () => {
  it('keeps positions unique per live card in a column and frees them on soft delete', async () => {
    const id = await project('POS');
    const first = await insert(newCard(id, { position: 'V' }));
    await expect(insert(newCard(id, { position: 'V' }))).rejects.toThrow();
    await insert(newCard(id, { position: 'V', status: 'todo' }));
    await testDb.db.update(cards).set({ deletedAt: now }).where(eq(cards.id, first.id));
    await insert(newCard(id, { position: 'V' }));
  });

  it('finds the last position of a column in byte order, ignoring deleted cards', async () => {
    const id = await project('LST');
    expect(await lastPosition(testDb.db, id, 'backlog')).toBeUndefined();
    await insert(newCard(id, { position: 'a1' }));
    await insert(newCard(id, { position: 'B1' }));
    const last = await insert(newCard(id, { position: 'z1' }));
    expect(await lastPosition(testDb.db, id, 'backlog')).toBe('z1');
    await testDb.db.update(cards).set({ deletedAt: now }).where(eq(cards.id, last.id));
    expect(await lastPosition(testDb.db, id, 'backlog')).toBe('a1');
  });
});

describe('board listing', () => {
  async function seed() {
    const id = await project(
      `B${String.fromCharCode(65 + (positions % 26))}${String.fromCharCode(65 + (positions % 7))}`,
    );
    const labelRow = (name: string) => ({
      id: newId('label'),
      projectId: id,
      name,
      color: '#d73a4a',
      createdAt: now,
    });
    const bug = labelRow('bug');
    const urgent = labelRow('urgent');
    await testDb.db.insert(labels).values([bug, urgent]);
    const botId = newId('bot');
    const a = await insert(
      newCard(id, { title: 'Corrigir 100% do login', position: 'b1', priority: 'high' }),
    );
    const b = await insert(
      newCard(id, { title: 'Corrigir typo', position: 'a1', assignee: { type: 'bot', id: botId } }),
    );
    const c = await insert(
      newCard(id, { title: 'Novo botão', position: 'c1', priority: 'high', status: 'todo' }),
    );
    await testDb.db.insert(cardLabels).values([
      { cardId: a.id, labelId: bug.id },
      { cardId: a.id, labelId: urgent.id },
      { cardId: c.id, labelId: bug.id },
    ]);
    return { id, bug, urgent, botId, a, b, c };
  }
  const titles = (list: { title: string }[]) => list.map((card) => card.title);

  it('lists live cards ordered by position in byte order, with their labels', async () => {
    const { id, a, b, bug, urgent } = await seed();
    const all = await listBoardCards(testDb.db, id);
    expect(titles(all.filter((card) => card.status === 'backlog'))).toEqual([b.title, a.title]);
    expect(all.find((card) => card.id === a.id)?.labels).toEqual([bug.id, urgent.id]);
    expect(all.find((card) => card.id === b.id)?.labels).toEqual([]);
    await testDb.db.update(cards).set({ deletedAt: now }).where(eq(cards.id, b.id));
    expect(await listBoardCards(testDb.db, id)).toHaveLength(2);
    expect(await listBoardCards(testDb.db, newId('project'))).toEqual([]);
  });

  it('combines filters with AND', async () => {
    const { id, bug, urgent, botId, a, c } = await seed();
    const ids = async (query: Parameters<typeof listBoardCards>[2]) =>
      (await listBoardCards(testDb.db, id, query)).map((card) => card.id).sort();
    expect(await ids({ priority: 'high' })).toEqual([a.id, c.id].sort());
    expect(await ids({ labelId: bug.id })).toEqual([a.id, c.id].sort());
    expect(await ids({ labelId: bug.id, priority: 'high' })).toEqual([a.id, c.id].sort());
    expect(await ids({ labelId: urgent.id, text: 'login' })).toEqual([a.id]);
    expect(await ids({ labelId: urgent.id, text: 'typo' })).toEqual([]);
    expect(await ids({ assignee: { type: 'bot', id: botId } })).toHaveLength(1);
    expect(await ids({ assignee: { type: 'bot', id: botId }, priority: 'high' })).toEqual([]);
    expect(await ids({ text: 'CORRIGIR' })).toHaveLength(2);
  });

  it('treats search text literally, including LIKE wildcards', async () => {
    const { id, a } = await seed();
    const found = async (text: string) =>
      (await listBoardCards(testDb.db, id, { text })).map((card) => card.id);
    expect(await found('100%')).toEqual([a.id]);
    expect(await found('%')).toEqual([a.id]);
    expect(await found('_')).toEqual([]);
    expect(await found('\\')).toEqual([]);
  });
});
