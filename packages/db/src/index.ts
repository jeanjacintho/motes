import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function createDb(url: string) {
  return drizzle({ client: postgres(url, { onnotice: () => {} }) });
}

export type Db = ReturnType<typeof createDb>;
export { appendEvent, type DbTransaction, readEventsAfter, type StoredEvent } from './events.js';
export { migrate, migrationsUpToDate } from './migrate.js';
export { events } from './schema.js';
