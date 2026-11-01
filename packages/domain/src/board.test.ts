import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { CARD_STATUSES, type CardStatus, newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { getBoard, moveCard } from './board.js';
import { assignCard, createCard } from './cards.js';
import { Conflict, Forbidden, NotFound, ValidationFailed } from './errors.js';
import { attachLabel, createLabel } from './labels.js';
import { createProject } from './projects.js';
import { changeStatus } from './status.js';

const testDb = withTestDb();
const bot = newId('bot');

function services() {
  return {
    db: testDb.db,
    appendEvent,
    clock: () => new Date('2026-10-31T10:00:00.000Z'),
    newId,
    botExists: async () => true,
  };
}

let counter = 0;
async function newProject() {
  const key = `M${String.fromCharCode(65 + (counter % 26))}${String.fromCharCode(65 + Math.floor(counter / 26))}`;
  counter++;
  return createProject(services(), { key, name: key });
}

async function titles(projectId: string, status: CardStatus) {
  const board = await getBoard(services(), projectId);
  return board.columns.find((column) => column.status === status)?.cards.map((c) => c.title);
}

async function eventTypes(cardId: string) {
  const rows = await testDb.db.$client`
    SELECT type FROM events WHERE subject_id = ${cardId} ORDER BY seq`;
  return rows.map((row) => row.type);
}

async function stack(projectId: string, names: string[]) {
  const created = [];
  for (const title of names) created.push(await createCard(services(), projectId, { title }));
  return created;
}

describe('card positions', () => {
  it('puts new cards at the bottom of backlog and entering cards at the bottom of the column', async () => {
    const project = await newProject();
    const [a, b, c] = await stack(project.id, ['a', 'b', 'c']);
    expect(await titles(project.id, 'backlog')).toEqual(['a', 'b', 'c']);
    await changeStatus(services(), c?.id as string, 'todo');
    await changeStatus(services(), a?.id as string, 'todo');
    expect(await titles(project.id, 'todo')).toEqual(['c', 'a']);
    expect(await titles(project.id, 'backlog')).toEqual(['b']);
    expect(b).toBeDefined();
  });
});

describe('moveCard', () => {
  it('reorders inside a column writing only the moved card and emitting card.moved', async () => {
    const project = await newProject();
    const [a, b, c, d] = await stack(project.id, ['a', 'b', 'c', 'd']);
    const before = await testDb.db
      .$client`SELECT id, position FROM cards WHERE project_id = ${project.id}`;
    await moveCard(services(), d?.id as string, 'backlog', { beforeId: b?.id });
    expect(await titles(project.id, 'backlog')).toEqual(['a', 'd', 'b', 'c']);
    await moveCard(services(), a?.id as string, 'backlog', { afterId: c?.id });
    expect(await titles(project.id, 'backlog')).toEqual(['d', 'b', 'c', 'a']);
    await moveCard(services(), c?.id as string, 'backlog', { afterId: d?.id, beforeId: b?.id });
    expect(await titles(project.id, 'backlog')).toEqual(['d', 'c', 'b', 'a']);
    await moveCard(services(), b?.id as string, 'backlog');
    expect(await titles(project.id, 'backlog')).toEqual(['d', 'c', 'a', 'b']);
    const after = await testDb.db
      .$client`SELECT id, position FROM cards WHERE project_id = ${project.id}`;
    // Only the cards that were moved changed position; the others were never rewritten.
    const changed = after.filter(
      (row) => before.find((old) => old.id === row.id)?.position !== row.position,
    );
    expect(changed.map((row) => row.id).sort()).toEqual([a?.id, b?.id, c?.id, d?.id].sort());
    expect(await eventTypes(d?.id as string)).toEqual(['card.created', 'card.moved']);
  });

  it('changes column as a status change at the requested spot', async () => {
    const project = await newProject();
    const [a, b, c] = await stack(project.id, ['a', 'b', 'c']);
    await moveCard(services(), a?.id as string, 'todo');
    await moveCard(services(), b?.id as string, 'todo', { beforeId: a?.id });
    const moved = await moveCard(services(), c?.id as string, 'todo', {
      afterId: b?.id,
      beforeId: a?.id,
    });
    expect(moved.status).toBe('todo');
    expect(await titles(project.id, 'todo')).toEqual(['b', 'c', 'a']);
    expect(await titles(project.id, 'backlog')).toEqual([]);
    expect(await eventTypes(c?.id as string)).toEqual(['card.created', 'card.status_changed']);
  });

  it('is a no-op when the card already sits there', async () => {
    const project = await newProject();
    const [a, b, c] = await stack(project.id, ['a', 'b', 'c']);
    await moveCard(services(), b?.id as string, 'backlog', { afterId: a?.id });
    await moveCard(services(), b?.id as string, 'backlog', { beforeId: c?.id });
    await moveCard(services(), c?.id as string, 'backlog');
    await moveCard(services(), a?.id as string, 'backlog', { beforeId: b?.id });
    expect(await eventTypes(b?.id as string)).toEqual(['card.created']);
    expect(await eventTypes(c?.id as string)).toEqual(['card.created']);
  });

  it('follows the status rules when the column changes', async () => {
    const project = await newProject();
    const [a] = await stack(project.id, ['a']);
    await expect(moveCard(services(), a?.id as string, 'done')).rejects.toBeInstanceOf(Conflict);
    await moveCard(services(), a?.id as string, 'todo');
    await expect(
      moveCard(services(), a?.id as string, 'in_progress', {}, { kind: 'bot', id: bot }),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await titles(project.id, 'todo')).toEqual(['a']);
  });

  it('refuses neighbours outside the target column, itself, misordered pairs and unknown cards', async () => {
    const project = await newProject();
    const other = await newProject();
    const [a, b] = await stack(project.id, ['a', 'b']);
    const [foreign] = await stack(other.id, ['f']);
    await moveCard(services(), b?.id as string, 'todo');
    const rejects = (
      place: { beforeId?: string | undefined; afterId?: string | undefined },
      status: CardStatus = 'todo',
    ) =>
      expect(moveCard(services(), a?.id as string, status, place)).rejects.toBeInstanceOf(
        ValidationFailed,
      );
    await rejects({ beforeId: a?.id });
    await rejects({ afterId: a?.id }, 'backlog');
    await rejects({ beforeId: foreign?.id });
    await rejects({ beforeId: newId('card') });
    await rejects({ beforeId: b?.id }, 'backlog');
    await expect(moveCard(services(), newId('card'), 'todo')).rejects.toBeInstanceOf(NotFound);
    await moveCard(services(), a?.id as string, 'todo', { beforeId: b?.id });
    await expect(
      moveCard(services(), a?.id as string, 'todo', { afterId: b?.id, beforeId: a?.id }),
    ).rejects.toBeInstanceOf(ValidationFailed);
    const c = (await stack(project.id, ['c']))[0];
    await moveCard(services(), c?.id as string, 'todo', { afterId: b?.id });
    await expect(
      moveCard(services(), c?.id as string, 'todo', { afterId: b?.id, beforeId: a?.id }),
    ).rejects.toBeInstanceOf(ValidationFailed);
  });

  it('refuses a stale pair of neighbours that is no longer adjacent, changing nothing', async () => {
    const project = await newProject();
    const [a, b, c, d] = await stack(project.id, ['a', 'b', 'c', 'd']);
    // d takes the gap between a and b, so a card now sits between a and b for the next caller.
    await moveCard(services(), d?.id as string, 'backlog', { afterId: a?.id, beforeId: b?.id });
    expect(await titles(project.id, 'backlog')).toEqual(['a', 'd', 'b', 'c']);
    const positions = () =>
      testDb.db
        .$client`SELECT id, position FROM cards WHERE project_id = ${project.id} ORDER BY id`;
    const before = await positions();
    await expect(
      moveCard(services(), c?.id as string, 'backlog', { afterId: a?.id, beforeId: b?.id }),
    ).rejects.toBeInstanceOf(ValidationFailed);
    // A card that already lies somewhere between the bounds is not "directly" there either.
    await expect(
      moveCard(services(), d?.id as string, 'backlog', { afterId: a?.id, beforeId: c?.id }),
    ).rejects.toBeInstanceOf(ValidationFailed);
    expect(await positions()).toEqual(before);
    expect(await titles(project.id, 'backlog')).toEqual(['a', 'd', 'b', 'c']);
    expect(await eventTypes(c?.id as string)).toEqual(['card.created']);
    expect(await eventTypes(d?.id as string)).toEqual(['card.created', 'card.moved']);
  });

  it('keeps positions unique and ordered over 50 random moves', async () => {
    const project = await newProject();
    const cardsMade = await stack(
      project.id,
      Array.from({ length: 12 }, (_, i) => `c${i}`),
    );
    // The model board mirrors what the database should return after every move.
    const model = new Map<CardStatus, string[]>(CARD_STATUSES.map((status) => [status, []]));
    model.set(
      'backlog',
      cardsMade.map((card) => card.id),
    );
    let seed = 42;
    const random = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };
    // Planning statuses are mutually reachable, so any card can go to any of them.
    const columns: CardStatus[] = ['backlog', 'todo', 'blocked'];
    for (let step = 0; step < 50; step++) {
      const all = [...model.values()].flat();
      const id = all[random(all.length)] as string;
      const to = columns[random(columns.length)] as CardStatus;
      const target = (model.get(to) as string[]).filter((other) => other !== id);
      const at = random(target.length + 1);
      for (const list of model.values()) {
        const index = list.indexOf(id);
        if (index >= 0) list.splice(index, 1);
      }
      target.splice(at, 0, id);
      model.set(to, target);
      const place: { afterId?: string; beforeId?: string } = {};
      if (target[at - 1]) place.afterId = target[at - 1] as string;
      if (target[at + 1]) place.beforeId = target[at + 1] as string;
      await moveCard(services(), id, to, place);
      const board = await getBoard(services(), project.id);
      for (const column of board.columns)
        expect(
          column.cards.map((card) => card.id),
          `step ${step} ${column.status}`,
        ).toEqual(model.get(column.status));
    }
    const rows = await testDb.db.$client`
      SELECT status, position FROM cards WHERE project_id = ${project.id}`;
    expect(new Set(rows.map((row) => `${row.status}/${row.position}`)).size).toBe(rows.length);
  });
});

describe('getBoard', () => {
  async function seed() {
    const project = await newProject();
    const bug = await createLabel(services(), project.id, { name: 'bug', color: '#d73a4a' });
    const urgent = await createLabel(services(), project.id, { name: 'urgent', color: '#d73a4a' });
    const a = await createCard(services(), project.id, {
      title: 'Corrigir login',
      priority: 'high',
    });
    const b = await createCard(services(), project.id, { title: 'Corrigir typo' });
    const c = await createCard(services(), project.id, { title: 'Novo botão', priority: 'high' });
    await attachLabel(services(), a.id, bug.id);
    await attachLabel(services(), a.id, urgent.id);
    await attachLabel(services(), c.id, bug.id);
    await assignCard(services(), b.id, { type: 'bot', id: bot });
    await assignCard(services(), c.id, { type: 'owner', id: 'owner' });
    await moveCard(services(), c.id, 'todo');
    return { project, bug, urgent, a, b, c };
  }
  const idsOf = async (projectId: string, filters: Parameters<typeof getBoard>[2]) =>
    (await getBoard(services(), projectId, filters)).columns.flatMap((column) =>
      column.cards.map((card) => card.title),
    );

  it('returns every status as a column, grouped and ordered', async () => {
    const { project } = await seed();
    const board = await getBoard(services(), project.id);
    expect(board.columns.map((column) => column.status)).toEqual([...CARD_STATUSES]);
    expect(board.columns.map((column) => column.cards.length)).toEqual([2, 1, 0, 0, 0, 0, 0]);
  });

  it('combines assignee, label, priority and text filters', async () => {
    const { project, bug, urgent } = await seed();
    expect(await idsOf(project.id, { priority: 'high' })).toEqual(['Corrigir login', 'Novo botão']);
    expect(await idsOf(project.id, { labelId: bug.id })).toEqual(['Corrigir login', 'Novo botão']);
    expect(await idsOf(project.id, { labelId: bug.id, priority: 'high', text: 'botão' })).toEqual([
      'Novo botão',
    ]);
    expect(await idsOf(project.id, { labelId: urgent.id, text: 'botão' })).toEqual([]);
    expect(await idsOf(project.id, { assignee: { type: 'bot', id: bot } })).toEqual([
      'Corrigir typo',
    ]);
    expect(
      await idsOf(project.id, { assignee: { type: 'owner', id: 'owner' }, labelId: bug.id }),
    ).toEqual(['Novo botão']);
    expect(await idsOf(project.id, { text: 'CORRIGIR', priority: 'none' })).toEqual([
      'Corrigir typo',
    ]);
    expect(await idsOf(project.id, {})).toHaveLength(3);
  });

  it('reports unknown projects and bad filters', async () => {
    await expect(getBoard(services(), newId('project'))).rejects.toBeInstanceOf(NotFound);
    const { project } = await seed();
    await expect(getBoard(services(), project.id, { text: ' ' })).rejects.toBeInstanceOf(
      ValidationFailed,
    );
  });
});
