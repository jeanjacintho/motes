import type { EventEnvelope } from '@motes/protocol';
import { bigserial, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const events = pgTable('events', {
  seq: bigserial({ mode: 'bigint' }).primaryKey(),
  id: text().$type<EventEnvelope['id']>().notNull().unique(),
  type: text().notNull(),
  occurredAt: timestamp('occurred_at', {
    withTimezone: true,
    mode: 'date',
    precision: 3,
  }).notNull(),
  actor: jsonb().$type<EventEnvelope['actor']>().notNull(),
  subjectKind: text('subject_kind').notNull(),
  subjectId: text('subject_id').notNull(),
  payload: jsonb().$type<EventEnvelope['payload']>().notNull(),
});
