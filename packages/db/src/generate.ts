/// <reference lib="dom" />
/// <reference types="emscripten" />
// Kit exposes PGlite credentials in its PostgreSQL API declarations. Load their
// browser/Wasm types here; the application database driver remains postgres.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateDrizzleJson, generateMigration, up } from 'drizzle-kit/api-postgres';
import { listMigrationNames, migrationsDirectory } from './migrate.js';

async function schemaDiff(schema: Record<string, unknown>, directory: string) {
  const files = await listMigrationNames(directory);
  const meta = join(directory, 'meta');
  const snapshots = await readdir(meta).catch((error: unknown): string[] => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  const expected = files.map((file) => file.replace(/\.sql$/, '.json'));
  if (
    expected.some((file) => !snapshots.includes(file)) ||
    snapshots.some((file) => !expected.includes(file))
  ) {
    throw new Error('Every SQL migration must have a matching Drizzle snapshot in meta/.');
  }
  let previous = await generateDrizzleJson({});
  const last = expected.at(-1);
  if (last) {
    const snapshot: unknown = JSON.parse(await readFile(join(meta, last), 'utf8'));
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      throw new Error('Invalid migration snapshot');
    }
    previous = up(snapshot as Record<string, unknown>).snapshot;
  }
  const current = await generateDrizzleJson(schema, previous.id);
  const statements = await generateMigration(previous, current);
  return { files, current, statements };
}

export async function checkMigrations(
  schema: Record<string, unknown>,
  directory = migrationsDirectory,
) {
  const { statements } = await schemaDiff(schema, directory);
  if (statements.length > 0) {
    throw new Error('Schema differs from migrations. Run pnpm db:generate and review the SQL.');
  }
}

// Kit v1's CLI uses timestamped folders. Its PostgreSQL API lets us retain the
// project's plain NNNN_name.sql files and one corresponding snapshot per file.
export async function generateMigrations(
  schema: Record<string, unknown>,
  name: string,
  directory = migrationsDirectory,
): Promise<string | undefined> {
  if (!/^[a-z][a-z0-9_]*$/.test(name))
    throw new Error('Use a lowercase migration name with underscores.');
  const { files, current, statements } = await schemaDiff(schema, directory);
  if (statements.length === 0) return undefined;
  const next = files.length === 0 ? 0 : Number(files.at(-1)?.slice(0, 4)) + 1;
  if (next > 9999) throw new Error('Migration sequence is exhausted');
  const stem = `${String(next).padStart(4, '0')}_${name}`;
  const path = join(directory, `${stem}.sql`);
  await mkdir(join(directory, 'meta'), { recursive: true });
  await writeFile(path, `${statements.join('\n--> statement-breakpoint\n')}\n`, { flag: 'wx' });
  try {
    await writeFile(
      join(directory, 'meta', `${stem}.json`),
      `${JSON.stringify(current, null, 2)}\n`,
      { flag: 'wx' },
    );
  } catch (error) {
    await rm(path);
    throw error;
  }
  return `${stem}.sql`;
}
