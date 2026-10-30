import type { Db } from './index.js';

// Entity-specific helpers can extend this module as their tables are introduced.
export function createFixtures(db: Db) {
  return { insert: db.insert.bind(db) };
}
