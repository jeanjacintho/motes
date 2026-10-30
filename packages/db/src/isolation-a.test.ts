import { pgTable, text } from 'drizzle-orm/pg-core';
import { expect, test } from 'vitest';
import { withTestDb } from './testing.js';

const context = withTestDb();

test('parallel file A sees only its own row for the shared key', async () => {
  await context.db.$client`CREATE TABLE isolation_probe (id text PRIMARY KEY, value text NOT NULL)`;
  const probe = pgTable('isolation_probe', { id: text().primaryKey(), value: text().notNull() });
  await context.fx.insert(probe).values({ id: 'same-key', value: 'file-a' });
  await context.db.$client`SELECT pg_sleep(0.25)`;
  expect(await context.db.$client`SELECT * FROM isolation_probe`).toEqual([
    { id: 'same-key', value: 'file-a' },
  ]);
});
