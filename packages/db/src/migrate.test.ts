import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgTable, text } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { createDb } from './index.js';
import { migrate } from './migrate.js';

// P0-03-03 supplies the shared withTestDb helper. Until then, isolate this
// runner's bootstrap tests in fresh databases, never in the configured database.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('Set DATABASE_URL to a test Postgres instance with CREATEDB permission.');
const admin = postgres(databaseUrl, { onnotice: () => {} });
let db: ReturnType<typeof createDb>;
let directory: string;
let database: string;

beforeEach(async () => {
  database = `motes_test_${randomUUID().replaceAll('-', '')}`;
  await admin`CREATE DATABASE ${admin(database)}`;
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  db = createDb(url.toString());
  directory = await mkdtemp(join(tmpdir(), 'motes-migrations-'));
});

afterEach(async () => {
  await db?.$client.end();
  if (database) await admin`DROP DATABASE IF EXISTS ${admin(database)}`;
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

// The admin connection is shared only within this test file.
afterAll(() => admin.end());
