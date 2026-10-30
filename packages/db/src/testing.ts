import { afterAll, beforeAll, inject } from 'vitest';
import { createFixtures } from './fixtures.js';
import { createTestDatabase } from './test-database.js';

declare module 'vitest' {
  interface ProvidedContext {
    motesTestTemplate: string;
  }
}

export { createFixtures } from './fixtures.js';

// Register once at file scope. Read db/fx inside tests or later hooks.
export function withTestDb() {
  let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
  beforeAll(async () => {
    const template = inject('motesTestTemplate');
    if (!template)
      throw new Error('Configure @motes/db/test-global-setup before using withTestDb.');
    database = await createTestDatabase(template);
  });
  afterAll(async () => {
    await database?.close();
  });
  function current() {
    if (!database) throw new Error('withTestDb is only available after its beforeAll hook.');
    return database;
  }
  return {
    get db() {
      return current().db;
    },
    get fx() {
      return createFixtures(current().db);
    },
    get name() {
      return current().name;
    },
  };
}
