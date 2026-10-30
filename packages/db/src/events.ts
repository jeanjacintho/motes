import { type KnownEvent, pageRequestSchema, parseEvent } from '@motes/protocol';
import { asc, gt, sql } from 'drizzle-orm';
import type { Db } from './index.js';
import { events } from './schema.js';

export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export type StoredEvent = { seq: bigint; event: KnownEvent };

function storedEvent(row: typeof events.$inferSelect): StoredEvent {
  return {
    seq: row.seq,
    event: parseEvent({
      id: row.id,
      type: row.type,
      occurredAt: row.occurredAt.toISOString(),
      actor: row.actor,
      subject: { kind: row.subjectKind, id: row.subjectId },
      payload: row.payload,
    }),
  };
}

/** Use the same transaction as the domain change; the caller owns its commit. */
export async function appendEvent(tx: DbTransaction, envelope: unknown): Promise<StoredEvent> {
  const event = parseEvent(envelope);
  // Serialize allocation until commit so a reader cannot advance past an
  // uncommitted lower seq. This lock is separate from the migration lock.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(1984020304)`);
  const [row] = await tx
    .insert(events)
    .values({
      id: event.id,
      type: event.type,
      occurredAt: new Date(event.occurredAt),
      actor: event.actor,
      subjectKind: event.subject.kind,
      subjectId: event.subject.id,
      payload: event.payload,
    })
    .returning();
  if (!row) throw new Error('Event insertion returned no row');
  return storedEvent(row);
}

/** Zero starts replay. Keep cursors as bigint (decimal strings on the wire). */
export async function readEventsAfter(db: Db, seq: bigint, limit: number): Promise<StoredEvent[]> {
  if (typeof seq !== 'bigint' || seq < 0n || seq > 9223372036854775807n)
    throw new RangeError('Event cursor must be a nonnegative PostgreSQL bigint');
  const page = pageRequestSchema.parse({ limit });
  const rows = await db
    .select()
    .from(events)
    .where(gt(events.seq, seq))
    .orderBy(asc(events.seq))
    .limit(page.limit);
  return rows.map(storedEvent);
}
