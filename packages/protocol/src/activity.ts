import { z } from 'zod';
import { timestampSchema } from './base.js';
import { idSchema } from './ids.js';

/** The events that leave a line in a card's timeline; a moved card or a comment does not. */
export const ACTIVITY_EVENT_TYPES = [
  'card.created',
  'card.updated',
  'card.assigned',
  'card.status_changed',
  'card.labels_changed',
  'card.deleted',
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/**
 * One system line of the timeline. The type is the event type that produced it and the payload is
 * that event's payload without the project id; `views` turns both into text. Clients must show a
 * generic line for a type they do not know, since later epics add run and handoff entries.
 */
export const activityEntrySchema = z.object({
  /** The id of the event it came from, which makes projecting the same event twice harmless. */
  id: idSchema('event'),
  cardId: idSchema('card'),
  type: z.string().min(1),
  actor: z.object({ kind: z.string().min(1), id: z.string().min(1).optional() }),
  payload: z.record(z.string(), z.json()),
  occurredAt: timestampSchema,
});
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
