import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Db } from './index.js';
import { migrate } from './migrate.js';
import { createTestDatabase } from './test-database.js';

// Migration bootstrap tests deliberately use unmigrated databases, not clones.
let db: Db;
let directory: string;
let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;

beforeEach(async () => {
  database = await createTestDatabase();
  db = database.db;
  directory = await mkdtemp(join(tmpdir(), 'motes-migrations-'));
});

afterEach(async () => {
  await database?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('applies files in filename order, records them, and a second run is a no-op', async () => {
  await writeFile(join(directory, '0001_insert.sql'), "INSERT INTO probe VALUES ('first');");
  await writeFile(join(directory, '0000_create.sql'), 'CREATE TABLE probe (value text);');
  expect(await migrate(db, directory)).toEqual(['0000_create.sql', '0001_insert.sql']);
  expect(await migrate(db, directory)).toEqual([]);
  const probe = pgTable('probe', { value: text() });
  expect(await db.select().from(probe)).toEqual([{ value: 'first' }]);
  expect(await db.$client`SELECT name FROM schema_migrations ORDER BY name`).toEqual([
    { name: '0000_create.sql' },
    { name: '0001_insert.sql' },
  ]);
});

test('rolls back valid DDL preceding invalid SQL and does not record the failed migration', async () => {
  await writeFile(join(directory, '0000_good.sql'), 'CREATE TABLE earlier (id integer);');
  await writeFile(
    join(directory, '0001_bad.sql'),
    'CREATE TABLE rolled_back (id integer);\n--> statement-breakpoint\nINSERT INTO table_that_does_not_exist VALUES (1);',
  );
  await expect(migrate(db, directory)).rejects.toThrow();
  expect(await db.$client`SELECT to_regclass('rolled_back') AS name`).toEqual([{ name: null }]);
  expect(await db.$client`SELECT name FROM schema_migrations`).toEqual([{ name: '0000_good.sql' }]);
  await writeFile(join(directory, '0001_bad.sql'), 'CREATE TABLE recovered (id integer);');
  expect(await migrate(db, directory)).toEqual(['0001_bad.sql']);
});

test('refuses edits and removal of applied migrations', async () => {
  const path = join(directory, '0000_applied.sql');
  await writeFile(path, 'CREATE TABLE probe (id integer);');
  await migrate(db, directory);
  await writeFile(path, 'CREATE TABLE probe (id text);');
  await expect(migrate(db, directory)).rejects.toThrow(/changed/);
  await rm(path);
  await expect(migrate(db, directory)).rejects.toThrow(/missing/);
});

test('concurrent runners apply each file once', async () => {
  await writeFile(join(directory, '0000_once.sql'), 'CREATE TABLE probe (id integer);');
  const results = await Promise.all([migrate(db, directory), migrate(db, directory)]);
  expect(results.flat()).toEqual(['0000_once.sql']);
  expect(await db.$client`SELECT count(*)::int AS count FROM schema_migrations`).toEqual([
    { count: 1 },
  ]);
});
