import { afterAll, describe, expect, inject, test } from 'vitest';
import { createTestDatabase } from './test-database.js';
import { withTestDb } from './testing.js';

const context = withTestDb();
let suiteDatabase: string;

describe('file/suite lifecycle', () => {
  const suite = withTestDb();
  test('provides a migrated database', async () => {
    suiteDatabase = suite.name;
    expect(await suite.db.$client`SELECT to_regclass('schema_migrations') AS name`).toEqual([
      { name: 'schema_migrations' },
    ]);
  });
});

afterAll(async () => {
  // The nested suite's registered afterAll has already disposed its database.
  expect(
    await context.db.$client`SELECT datname FROM pg_database WHERE datname = ${suiteDatabase}`,
  ).toEqual([]);
});

test('removes a clone when the caller fails and permits repeated close', async () => {
  const temporary = await createTestDatabase(inject('motesTestTemplate'));
  expect(await temporary.db.$client`SELECT to_regclass('schema_migrations') AS name`).toEqual([
    { name: 'schema_migrations' },
  ]);
  expect(
    await context.db.$client`SELECT datname FROM pg_database WHERE datname = ${temporary.name}`,
  ).toHaveLength(1);
  await expect(
    (async () => {
      try {
        throw new Error('test body failed');
      } finally {
        await temporary.close();
      }
    })(),
  ).rejects.toThrow('test body failed');
  expect(
    await context.db.$client`SELECT datname FROM pg_database WHERE datname = ${temporary.name}`,
  ).toEqual([]);
  await temporary.close();
});
