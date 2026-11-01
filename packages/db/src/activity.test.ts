import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { insertActivity, listActivity } from './activity.js';
import { insertCard } from './cards.js';
import { projects } from './schema.js';
import { withTestDb } from './testing.js';

const testDb = withTestDb();
const now = new Date('2026-10-31T10:00:00.000Z');

async function newCard(key: string) {
  const projectId = newId('project');
  await testDb.db
    .insert(projects)
    .values({ id: projectId, key, name: key, description: '', createdAt: now });
  return testDb.db.transaction((tx) =>
    insertCard(tx, {
      id: newId('card'),
      projectId,
      title: 'x',
      position: 'V',
      createdBy: { type: 'owner', id: 'owner' },
      now,
    }),
  );
}

const entry = (cardId: string, seq: bigint, overrides: object = {}) => ({
  id: newId('event'),
  seq,
  cardId,
  type: 'card.updated',
  actor: { kind: 'owner' },
  payload: { changed: ['title'] },
  occurredAt: now,
  ...overrides,
});

describe('card activity storage', () => {
  it('lists a card lines in event order and keeps cards apart', async () => {
    const card = await newCard('ACA');
    const other = await newCard('ACB');
    const later = entry(card.id, 20n);
    const earlier = entry(card.id, 10n, { type: 'card.created', payload: { number: 1 } });
    await testDb.db.transaction(async (tx) => {
      await insertActivity(tx, later);
      await insertActivity(tx, earlier);
      await insertActivity(tx, entry(other.id, 15n));
    });
    const lines = await listActivity(testDb.db, card.id);
    expect(lines.map((line) => line.id)).toEqual([earlier.id, later.id]);
    expect(lines[0]).toMatchObject({
      cardId: card.id,
      type: 'card.created',
      actor: { kind: 'owner' },
      payload: { number: 1 },
      occurredAt: now.toISOString(),
    });
  });

  it('ignores an event that was already projected', async () => {
    const card = await newCard('ACC');
    const line = entry(card.id, 1n);
    await testDb.db.transaction(async (tx) => {
      await insertActivity(tx, line);
      await insertActivity(tx, { ...line, payload: { changed: ['other'] } });
    });
    const lines = await listActivity(testDb.db, card.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.payload).toEqual({ changed: ['title'] });
  });

  it('rejects a line for a card that does not exist', async () => {
    await expect(
      testDb.db.transaction((tx) => insertActivity(tx, entry(newId('card'), 1n))),
    ).rejects.toThrow();
  });
});
