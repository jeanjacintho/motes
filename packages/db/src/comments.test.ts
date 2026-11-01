import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { insertCard } from './cards.js';
import { comments, projects } from './schema.js';
import { withTestDb } from './testing.js';

const testDb = withTestDb();
const now = new Date('2026-10-31T10:00:00.000Z');

describe('comment storage', () => {
  it('stores a comment for a card and rejects rows the domain should never write', async () => {
    const projectId = newId('project');
    await testDb.db
      .insert(projects)
      .values({ id: projectId, key: 'CMT', name: 'CMT', description: '', createdAt: now });
    const card = await testDb.db.transaction((tx) =>
      insertCard(tx, {
        id: newId('card'),
        projectId,
        title: 'x',
        position: 'V',
        createdBy: { type: 'owner', id: 'owner' },
        now,
      }),
    );
    const row = {
      id: newId('comment'),
      cardId: card.id,
      authorType: 'owner',
      authorId: 'owner',
      body: 'oi',
      createdAt: now,
    };
    const rejects = (overrides: Record<string, unknown>) =>
      expect(
        testDb.db.insert(comments).values({ ...row, id: newId('comment'), ...overrides }),
      ).rejects.toThrow();
    await testDb.db.insert(comments).values(row);
    await rejects({ authorType: 'system' });
    await rejects({ authorId: ' ' });
    await rejects({ body: '  ' });
    await rejects({ cardId: newId('card') });
    await rejects({ id: row.id });
  });
});
