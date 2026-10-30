import { appendEvent, type Db } from '@motes/db';
import { newId } from '@motes/protocol';

export function createServices(db: Db) {
  return { db, appendEvent, clock: () => new Date(), newId };
}

export type Services = ReturnType<typeof createServices>;
