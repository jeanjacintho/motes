import {
  type appendEvent,
  cards,
  eq,
  insertActivity,
  listActivity,
  readEventsAfter,
  type StoredEvent,
} from '@motes/db';
import { ACTIVITY_EVENT_TYPES, type ActivityEntry } from '@motes/protocol';
import { NotFound } from './errors.js';
import type { Services, Tx } from './shared.js';

/** Turns one stored event into its timeline line, or nothing when the event has none. */
export async function projectActivity(tx: Tx, { seq, event }: StoredEvent): Promise<void> {
  if (!(ACTIVITY_EVENT_TYPES as readonly string[]).includes(event.type)) return;
  if (event.subject.kind !== 'card') return;
  const { projectId: _projectId, ...payload } = event.payload as Record<string, unknown>;
  await insertActivity(tx, {
    id: event.id,
    seq,
    cardId: event.subject.id,
    type: event.type,
    actor: event.actor,
    payload: payload as ActivityEntry['payload'],
    occurredAt: new Date(event.occurredAt),
  });
}

/**
 * Appends events as usual and projects each one in the same transaction, so a card's timeline
 * never lags behind its events and a rollback takes both away.
 */
export function withActivityProjection(append: typeof appendEvent): typeof appendEvent {
  return async (tx, envelope) => {
    const stored = await append(tx, envelope);
    await projectActivity(tx, stored);
    return stored;
  };
}

/**
 * Projects every stored event again. Lines that exist are left alone, so this both rebuilds a
 * wiped table and fills gaps. Returns how many events it went through.
 */
export async function replayActivity(
  services: Services,
  options: { batchSize?: number } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 200;
  let cursor = 0n;
  let scanned = 0;
  for (;;) {
    const page = await readEventsAfter(services.db, cursor, batchSize);
    if (page.length === 0) return scanned;
    await services.db.transaction(async (tx) => {
      for (const stored of page) await projectActivity(tx, stored);
    });
    cursor = page[page.length - 1]?.seq ?? cursor;
    scanned += page.length;
  }
}

/** A card keeps its history after it is deleted; only ids that never existed are NotFound. */
export async function listCardActivity(
  services: Services,
  cardId: string,
): Promise<ActivityEntry[]> {
  const [card] = await services.db.select({ id: cards.id }).from(cards).where(eq(cards.id, cardId));
  if (!card) throw new NotFound('Card not found');
  return listActivity(services.db, cardId);
}
