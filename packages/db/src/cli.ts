import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { checkMigrations, generateMigrations } from './generate.js';
import { createDb, migrate } from './index.js';
import * as schema from './schema.js';

const command = process.argv[2];
if (
  !['migrate', 'check', 'generate'].includes(command ?? '') ||
  (command === 'generate' ? process.argv.length !== 4 : process.argv.length !== 3)
) {
  console.error('Usage: pnpm db:migrate | pnpm db:check | pnpm db:generate <name>');
  process.exit(1);
}

try {
  if (command === 'generate') {
    const name = process.argv[3];
    if (!name) throw new Error('A migration name is required');
    const file = await generateMigrations(schema, name);
    console.log(file ? `Generated ${file}. Review the SQL before applying.` : 'No schema changes.');
  } else if (command === 'check') {
    await checkMigrations(schema);
    console.log('Schema matches migration snapshots.');
  } else {
    try {
      loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);
    try {
      const applied = await migrate(db);
      console.log(`Applied ${applied.length} migration(s).`);
    } finally {
      await db.$client.end();
    }
  }
} catch {
  // Driver errors can contain connection credentials. Keep CLI failures redacted.
  console.error(
    command !== 'migrate'
      ? 'Schema generation/check failed. Review the schema, SQL, and snapshots; use a lowercase migration name.'
      : 'Migration failed. Check DATABASE_URL, database connectivity, and pending SQL files.',
  );
  process.exitCode = 1;
}
