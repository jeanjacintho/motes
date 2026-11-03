import { z } from 'zod';
import { activityEntrySchema } from './activity.js';
import { pageSchema, timestampSchema } from './base.js';
import { commentSchema } from './comments.js';

export const TIMELINE_DEFAULT_LIMIT = 50;
export const TIMELINE_MAX_LIMIT = 100;

/** One line of a card's timeline: something a person or bot said, or something that happened. */
export const timelineItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('comment'), at: timestampSchema, comment: commentSchema }),
  z.object({ kind: z.literal('activity'), at: timestampSchema, entry: activityEntrySchema }),
]);
export type TimelineItem = z.infer<typeof timelineItemSchema>;

export const timelinePageSchema = pageSchema(timelineItemSchema);
export type TimelinePage = z.infer<typeof timelinePageSchema>;

/** Oldest first; `cursor` is the `nextCursor` of the previous page and is opaque to clients. */
export const timelineQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(TIMELINE_MAX_LIMIT).default(TIMELINE_DEFAULT_LIMIT),
});
export type TimelineQuery = z.input<typeof timelineQuerySchema>;
