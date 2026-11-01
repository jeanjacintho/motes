import { type ActivityEntry, activityEntrySchema } from '@motes/protocol';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from './events.js';
import type { Db } from './index.js';
import { cardActivity } from './schema.js';

export type NewActivity = Omit<ActivityEntry, 'occurredAt'> & { seq: bigint; occurredAt: Date };

/** Inserting an event that was already projected changes nothing. */
export async function insertActivity(tx: DbTransaction, input: NewActivity): Promise<void> {
  await tx
    .insert(cardActivity)
    .values({
      id: input.id,
      seq: input.seq,
      cardId: input.cardId,
      type: input.type,
      actor: input.actor,
      payload: input.payload,
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing();
}

type Reader = Pick<Db, 'select'>;

/** The card's timeline lines in the order the events happened. */
export async function listActivity(db: Reader, cardId: string): Promise<ActivityEntry[]> {
  const rows = await db
    .select()
    .from(cardActivity)
    .where(sql`${cardActivity.cardId} = ${cardId}`)
    .orderBy(cardActivity.seq);
  return rows.map((row) =>
    activityEntrySchema.parse({
      id: row.id,
      cardId: row.cardId,
      type: row.type,
      actor: row.actor,
      payload: row.payload,
      occurredAt: row.occurredAt.toISOString(),
    }),
  );
}
