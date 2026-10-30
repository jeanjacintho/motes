import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, expect, test } from 'vitest';
import { checkMigrations, generateMigrations } from './generate.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'motes-schema-'));
  roots.push(directory);
  return directory;
}

test('detects a missing migration and passes after Kit generates plain SQL and a snapshot', async () => {
  const directory = await fixture();
  const schema = { probe: pgTable('probe', { id: integer().primaryKey() }) };
  await expect(checkMigrations(schema, directory)).rejects.toThrow(/Schema differs/);
  expect(await generateMigrations(schema, 'probe', directory)).toBe('0000_probe.sql');
  expect(await readFile(join(directory, '0000_probe.sql'), 'utf8')).toContain('CREATE TABLE');
  const snapshot = await readFile(join(directory, 'meta', '0000_probe.json'), 'utf8');
  await expect(checkMigrations(schema, directory)).resolves.toBeUndefined();
  expect(await readFile(join(directory, 'meta', '0000_probe.json'), 'utf8')).toBe(snapshot);
  expect(await generateMigrations(schema, 'noop', directory)).toBeUndefined();
  expect(await readdir(directory)).toEqual(['0000_probe.sql', 'meta']);
});

test('detects a new column, generates the next file, and passes with the new snapshot', async () => {
  const directory = await fixture();
  const initial = { probe: pgTable('probe', { id: integer().primaryKey() }) };
  await generateMigrations(initial, 'probe', directory);
  const changed = { probe: pgTable('probe', { id: integer().primaryKey(), name: text() }) };
  await expect(checkMigrations(changed, directory)).rejects.toThrow(/Schema differs/);
  expect(await readdir(directory)).toEqual(['0000_probe.sql', 'meta']);
  expect(await generateMigrations(changed, 'name', directory)).toBe('0001_name.sql');
  expect(await readFile(join(directory, '0001_name.sql'), 'utf8')).toContain('ADD COLUMN');
  await expect(checkMigrations(changed, directory)).resolves.toBeUndefined();
});

test('rejects missing SQL and missing snapshots instead of reporting a clean schema', async () => {
  const directory = await fixture();
  const schema = { probe: pgTable('probe', { id: integer().primaryKey() }) };
  await generateMigrations(schema, 'probe', directory);
  await rm(join(directory, '0000_probe.sql'));
  await expect(checkMigrations(schema, directory)).rejects.toThrow(/matching Drizzle snapshot/);
  await rm(join(directory, 'meta'), { recursive: true });
  await generateMigrations(schema, 'probe', directory);
  await rm(join(directory, 'meta', '0000_probe.json'));
  await expect(checkMigrations(schema, directory)).rejects.toThrow(/matching Drizzle snapshot/);
});

test('empty schema needs no business table or baseline migration', async () => {
  const directory = await fixture();
  await expect(checkMigrations({}, directory)).resolves.toBeUndefined();
  expect(await generateMigrations({}, 'initial', directory)).toBeUndefined();
  expect(await readdir(directory)).toEqual([]);
});
