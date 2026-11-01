import { appendEvent, type Db, repositoryHasCards } from '@motes/db';
import { newId } from '@motes/protocol';

export function createServices(db: Db) {
  return {
    db,
    appendEvent,
    clock: () => new Date(),
    newId,
    // No bots exist yet, so no bot can be assigned; the bots epic replaces this lookup.
    botExists: async () => false,
    // Cards reference repositories, so a referenced repository cannot be removed.
    repositoryInUse: (tx: Parameters<typeof repositoryHasCards>[0], id: string) =>
      repositoryHasCards(tx, id),
  };
}

export type Services = ReturnType<typeof createServices>;
