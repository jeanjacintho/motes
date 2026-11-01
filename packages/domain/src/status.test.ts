import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { CARD_STATUSES, type CardStatus, newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { createCard } from './cards.js';
import { Conflict, Forbidden, NotFound, ValidationFailed } from './errors.js';
import { createProject } from './projects.js';
import { canTransition, changeStatus, STATUS_TRANSITIONS } from './status.js';

const testDb = withTestDb();

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
async function cardIn(status: CardStatus) {
  const key = `S${String.fromCharCode(65 + (counter % 26))}${String.fromCharCode(65 + Math.floor(counter / 26))}`;
  counter++;
  const project = await createProject(services(), { key, name: key });
  const card = await createCard(services(), project.id, { title: 'x' });
  await testDb.db.$client`UPDATE cards SET status = ${status} WHERE id = ${card.id}`;
  return { project, card };
}

async function statusEvents(cardId: string) {
  const rows = await testDb.db.$client`
    SELECT payload FROM events WHERE subject_id = ${cardId} AND type = 'card.status_changed'
    ORDER BY seq`;
  return rows.map((row) => row.payload);
}

const pairs = CARD_STATUSES.flatMap((from) =>
  CARD_STATUSES.filter((to) => to !== from).map((to) => [from, to] as const),
);

describe('transition table', () => {
  it('only lists real statuses and never a status to itself', () => {
    for (const [from, targets] of Object.entries(STATUS_TRANSITIONS)) {
      expect(CARD_STATUSES).toContain(from);
      expect(targets).not.toContain(from);
      for (const to of targets) expect(CARD_STATUSES).toContain(to);
    }
  });

  it('keeps the rules the roadmap names', () => {
    expect(canTransition('done', 'todo')).toBe(true);
    expect(canTransition('done', 'cancelled')).toBe(false);
    expect(canTransition('done', 'in_progress')).toBe(false);
    for (const from of CARD_STATUSES.filter(
      (status) => status !== 'done' && status !== 'cancelled',
    ))
      expect(canTransition(from, 'cancelled'), from).toBe(true);
    expect(canTransition('backlog', 'done')).toBe(false);
  });
});

describe('changeStatus', () => {
  it.each(pairs)('%s → %s follows the table', async (from, to) => {
    const { project, card } = await cardIn(from);
    const result = changeStatus(services(), card.id, to);
    if (!canTransition(from, to)) {
      await expect(result).rejects.toBeInstanceOf(Conflict);
      expect(await statusEvents(card.id)).toEqual([]);
      return;
    }
    expect((await result).status).toBe(to);
    expect(await statusEvents(card.id)).toEqual([
      { projectId: project.id, from, to, reason: null },
    ]);
  });

  it('records the reason and the actor', async () => {
    const { card } = await cardIn('todo');
    await changeStatus(
      services(),
      card.id,
      'blocked',
      { kind: 'bot', id: newId('bot') },
      'Sem acesso',
    );
    const [row] = await testDb.db.$client`
      SELECT actor, payload FROM events WHERE type = 'card.status_changed' AND subject_id = ${card.id}`;
    expect(row?.payload).toMatchObject({ reason: 'Sem acesso' });
    expect(row?.actor).toMatchObject({ kind: 'bot' });
  });

  it('does nothing for the same status', async () => {
    const { card } = await cardIn('todo');
    expect((await changeStatus(services(), card.id, 'todo')).status).toBe('todo');
    expect(await statusEvents(card.id)).toEqual([]);
  });

  it('reserves in_progress and in_review to the system, but the owner may set them', async () => {
    const bot = { kind: 'bot', id: newId('bot') } as const;
    const a = await cardIn('todo');
    await expect(changeStatus(services(), a.card.id, 'in_progress', bot)).rejects.toBeInstanceOf(
      Forbidden,
    );
    const b = await cardIn('in_progress');
    await expect(changeStatus(services(), b.card.id, 'in_review', bot)).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect(
      (await changeStatus(services(), a.card.id, 'in_progress', { kind: 'system' })).status,
    ).toBe('in_progress');
    expect((await changeStatus(services(), b.card.id, 'in_review', { kind: 'owner' })).status).toBe(
      'in_review',
    );
    const c = await cardIn('in_progress');
    expect((await changeStatus(services(), c.card.id, 'blocked', bot)).status).toBe('blocked');
  });

  it('reports unknown cards and malformed input', async () => {
    await expect(changeStatus(services(), newId('card'), 'todo')).rejects.toBeInstanceOf(NotFound);
    const { card } = await cardIn('todo');
    await expect(changeStatus(services(), card.id, 'started' as never)).rejects.toBeInstanceOf(
      ValidationFailed,
    );
  });
});
