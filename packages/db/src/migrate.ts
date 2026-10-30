import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';

export const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const migrationLock = 1984020302;

type Migration = { name: string; sql: string; checksum: string };
type AppliedMigration = { name: string; checksum: string };

export async function migrationsUpToDate(
  db: Db,
  directory = migrationsDirectory,
): Promise<boolean> {
  const names = await listMigrationNames(directory);
  const exists = await db.$client<
    { present: boolean }[]
  >`SELECT to_regclass('schema_migrations') IS NOT NULL AS present`;
  if (!exists[0]?.present) return false;
  const history = await db.$client<
    AppliedMigration[]
  >`SELECT name, checksum FROM schema_migrations ORDER BY name`;
  if (history.length !== names.length) return false;
  for (const [index, name] of names.entries()) {
    const checksum = createHash('sha256')
      .update(await readFile(join(directory, name)))
      .digest('hex');
    if (history[index]?.name !== name || history[index]?.checksum !== checksum) return false;
  }
  return true;
}

export async function listMigrationNames(directory: string): Promise<string[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const prefixes = new Set<string>();
  for (const name of names) {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name))
      throw new Error(`Invalid migration filename: ${name}`);
    const prefix = name.slice(0, 4);
    if (prefixes.has(prefix)) throw new Error(`Duplicate migration number: ${name}`);
    prefixes.add(prefix);
  }
  return names;
}

export async function migrate(db: Db, directory = migrationsDirectory): Promise<string[]> {
  const names = await listMigrationNames(directory);
  const migrations: Migration[] = [];
  for (const name of names) {
    const sql = await readFile(join(directory, name), 'utf8');
    migrations.push({ name, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }

  await db.$client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${migrationLock})`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
  });

  const applied: string[] = [];
  // Even an empty directory must detect missing applied files.
  for (const migration of [undefined, ...migrations]) {
    await db.$client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${migrationLock})`;
      const history = await tx<
        AppliedMigration[]
      >`SELECT name, checksum FROM schema_migrations ORDER BY name`;
      for (const record of history) {
        const file = migrations.find((entry) => entry.name === record.name);
        if (!file) throw new Error(`Applied migration is missing: ${record.name}`);
        if (record.checksum !== file.checksum) {
          throw new Error(`Applied migration has changed: ${record.name}`);
        }
      }
      if (!migration || history.some((record) => record.name === migration.name)) return;
      if (history.some((record) => record.name > migration.name)) {
        throw new Error(`Migration precedes applied history: ${migration.name}`);
      }
      // Generated SQL is trusted repository code. Execute the whole file on this
      // transaction's connection, including Drizzle statement-breakpoint comments.
      await tx.unsafe(migration.sql).simple();
      await tx`INSERT INTO schema_migrations (name, checksum) VALUES (${migration.name}, ${migration.checksum})`;
      applied.push(migration.name);
    });
  }
  return applied;
}
