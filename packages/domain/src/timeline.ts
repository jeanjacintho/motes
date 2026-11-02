import { cards, eq, listActivityAfter, type TimelinePosition } from '@motes/db';
import { TIMELINE_DEFAULT_LIMIT, type TimelineItem, type TimelinePage } from '@motes/protocol';
import type { CardServices } from './cards.js';
import { listCommentsAfter } from './comments.js';
import { NotFound, ValidationFailed } from './errors.js';

const encodeCursor = (item: TimelineItem) =>
  Buffer.from(JSON.stringify([item.at, idOf(item)])).toString('base64url');

function decodeCursor(cursor: string): TimelinePosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw new ValidationFailed('Invalid cursor');
  }
  const [at, id] = Array.isArray(parsed) ? parsed : [];
  const time = typeof at === 'string' ? new Date(at) : undefined;
  if (!time || Number.isNaN(time.getTime()) || typeof id !== 'string' || id === '')
    throw new ValidationFailed('Invalid cursor');
  return { at: time, id };
}

const idOf = (item: TimelineItem) => (item.kind === 'comment' ? item.comment.id : item.entry.id);

// Time first, then id by code unit, which is how the queries order (COLLATE "C").
const compare = (a: TimelineItem, b: TimelineItem) =>
  a.at === b.at ? (idOf(a) < idOf(b) ? -1 : 1) : a.at < b.at ? -1 : 1;

/**
 * Comments and activity of a card merged into one stream, oldest first. Each source is read one
 * item past the page, so the merge knows whether more follows without a count. A card keeps its
 * history after it is deleted; only ids that never existed are NotFound.
 */
export async function getTimeline(
  services: CardServices,
  cardId: string,
  options: { cursor?: string | undefined; limit?: number | undefined } = {},
): Promise<TimelinePage> {
  const limit = options.limit ?? TIMELINE_DEFAULT_LIMIT;
  const after = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
  const [card] = await services.db.select({ id: cards.id }).from(cards).where(eq(cards.id, cardId));
  if (!card) throw new NotFound('Card not found');
  const [comments, activity] = await Promise.all([
    listCommentsAfter(services, cardId, after, limit + 1),
    listActivityAfter(services.db, cardId, after, limit + 1),
  ]);
  const merged: TimelineItem[] = [
    ...comments.map(
      (comment): TimelineItem => ({ kind: 'comment', at: comment.createdAt, comment }),
    ),
    ...activity.map((entry): TimelineItem => ({ kind: 'activity', at: entry.occurredAt, entry })),
  ].sort(compare);
  const items = merged.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: merged.length > limit && last ? encodeCursor(last) : null,
  };
}
