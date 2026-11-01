import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function createDb(url: string) {
  return drizzle({ client: postgres(url, { onnotice: () => {} }) });
}

export type Db = ReturnType<typeof createDb>;
export { eq, sql } from 'drizzle-orm';
export { insertActivity, listActivity, type NewActivity } from './activity.js';
export { botExists } from './bots.js';
export {
  type BoardQuery,
  cardFromRow,
  cardLabelIds,
  getCardById,
  getCardByRef,
  insertCard,
  lastPosition,
  listBoardCards,
  type NewCard,
  repositoryHasCards,
} from './cards.js';
export { appendEvent, type DbTransaction, readEventsAfter, type StoredEvent } from './events.js';
export { migrate, migrationsUpToDate } from './migrate.js';
export {
  bots,
  cardActivity,
  cardLabels,
  cards,
  comments,
  deviceTokens,
  events,
  labels,
  pairingState,
  projectCounters,
  projects,
  repositories,
  repositoryPaths,
} from './schema.js';
