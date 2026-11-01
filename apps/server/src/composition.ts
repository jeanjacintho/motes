import { appendEvent, type Db, repositoryHasCards } from '@motes/db';
import { withActivityProjection } from '@motes/domain';
import { newId } from '@motes/protocol';

export function createServices(db: Db) {
  return {
    db,
    // Every event that belongs on a card's timeline is projected in its own transaction.
    appendEvent: withActivityProjection(appendEvent),
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
