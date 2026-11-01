import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { botExists } from './bots.js';
import { bots } from './schema.js';
import { withTestDb } from './testing.js';

const testDb = withTestDb();
const now = new Date('2026-10-31T10:00:00.000Z');

const row = (overrides: Record<string, unknown> = {}) => ({
  id: newId('bot'),
  slug: `bot-${Math.random().toString(36).slice(2, 8)}`,
  displayName: 'Bot',
  kind: 'dev',
  engines: ['claude'],
  enabled: true,
  skillDigest: 'a'.repeat(64),
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe('bot index storage', () => {
  it('knows live bots only', async () => {
    const live = row();
    const gone = row({ removedAt: now });
    await testDb.db.insert(bots).values([live, gone] as never);
    expect(await botExists(testDb.db, live.id)).toBe(true);
    expect(await botExists(testDb.db, gone.id)).toBe(false);
    expect(await botExists(testDb.db, newId('bot'))).toBe(false);
  });

  it('rejects rows the domain should never write', async () => {
    const rejects = (overrides: Record<string, unknown>) =>
      expect(testDb.db.insert(bots).values(row(overrides) as never)).rejects.toThrow();
    await rejects({ kind: 'boss' });
    await rejects({ slug: 'Not A Slug' });
    await rejects({ skillDigest: 'short' });
    await rejects({ engines: [] });
    await rejects({ engines: 'claude' });
    const taken = row({ slug: 'taken-slug' });
    await testDb.db.insert(bots).values(taken as never);
    await rejects({ slug: 'taken-slug' });
  });
});
