import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function createDb(url: string) {
  return drizzle({ client: postgres(url, { onnotice: () => {} }) });
}

export type Db = ReturnType<typeof createDb>;
export { migrate } from './migrate.js';
