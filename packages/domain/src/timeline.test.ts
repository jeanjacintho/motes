import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { withActivityProjection } from './activity.js';
import { createCard, deleteCard, updateCard } from './cards.js';
import { addComment, deleteComment } from './comments.js';
import { NotFound, ValidationFailed } from './errors.js';
import { createProject } from './projects.js';
import { getTimeline } from './timeline.js';

const testDb = withTestDb();

function services(clock?: () => Date) {
  let tick = 0;
  return {
    db: testDb.db,
    appendEvent: withActivityProjection(appendEvent),
    // Every call moves the clock so the order of things is observable.
    clock: clock ?? (() => new Date(Date.parse('2026-10-31T10:00:00.000Z') + ++tick * 1000)),
    newId,
    botExists: async () => true,
  };
}

let counter = 0;
async function newCard(s = services()) {
  const key = `L${String.fromCharCode(65 + (counter % 26))}${String.fromCharCode(65 + Math.floor(counter / 26))}`;
  counter++;
  const project = await createProject(s, { key, name: key });
  const card = await createCard(s, project.id, { title: 'x' });
  return { s, card };
}

const describeItem = (item: Awaited<ReturnType<typeof getTimeline>>['items'][number]) =>
  item.kind === 'comment' ? `comment:${item.comment.body}` : `activity:${item.entry.type}`;

async function everything(s: ReturnType<typeof services>, cardId: string, limit: number) {
  const pages: string[][] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await getTimeline(s, cardId, { cursor, limit });
    pages.push(page.items.map(describeItem));
    if (page.nextCursor === null) return pages;
    cursor = page.nextCursor;
  }
}

describe('getTimeline', () => {
  it('interleaves comments and activity by time', async () => {
    const { s, card } = await newCard();
    await addComment(s, card.id, 'primeiro');
    await updateCard(s, card.id, { title: 'y' });
    await addComment(s, card.id, 'segundo');
    const page = await getTimeline(s, card.id);
    expect(page.items.map(describeItem)).toEqual([
      'activity:card.created',
      'comment:primeiro',
      'activity:card.updated',
      'comment:segundo',
    ]);
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => item.at)).toEqual(
      [...page.items.map((item) => item.at)].sort(),
    );
  });

  it('pages without repeating or skipping an item, whatever the page size', async () => {
    const { s, card } = await newCard();
    for (const n of [1, 2, 3]) {
      await addComment(s, card.id, `c${n}`);
      await updateCard(s, card.id, { title: `t${n}` });
    }
    const all = (await everything(s, card.id, 100)).flat();
    expect(all).toHaveLength(7);
    for (const limit of [1, 2, 3, 6, 7]) {
      const pages = await everything(s, card.id, limit);
      expect(pages.flat()).toEqual(all);
      expect(pages.slice(0, -1).every((page) => page.length === limit)).toBe(true);
    }
  });

  it('ends exactly on a full page without a dangling cursor', async () => {
    const { s, card } = await newCard();
    await addComment(s, card.id, 'a');
    const page = await getTimeline(s, card.id, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('orders items sharing a millisecond by id, across the page boundary', async () => {
    const frozen = () => new Date('2026-10-31T10:00:00.000Z');
    const { s, card } = await newCard(services(frozen));
    for (const n of [1, 2, 3, 4]) await addComment(s, card.id, `c${n}`);
    const all = (await everything(s, card.id, 100)).flat();
    expect((await everything(s, card.id, 2)).flat()).toEqual(all);
    expect(new Set(all).size).toBe(5);
  });

  it('leaves deleted comments out and keeps their activity neighbours', async () => {
    const { s, card } = await newCard();
    const gone = await addComment(s, card.id, 'apagado');
    await addComment(s, card.id, 'fica');
    await deleteComment(s, gone.id);
    expect((await getTimeline(s, card.id)).items.map(describeItem)).toEqual([
      'activity:card.created',
      'comment:fica',
    ]);
  });

  it('keeps the history of a deleted card and rejects an unknown one', async () => {
    const { s, card } = await newCard();
    await addComment(s, card.id, 'antes');
    await deleteCard(s, card.id);
    expect((await getTimeline(s, card.id)).items.map(describeItem)).toContain('comment:antes');
    await expect(getTimeline(s, newId('card'))).rejects.toBeInstanceOf(NotFound);
  });

  it.each([
    'garbage',
    Buffer.from('[1]').toString('base64url'),
    Buffer.from('["x","y"]').toString('base64url'),
  ])('rejects the cursor %s', async (cursor) => {
    const { s, card } = await newCard();
    await expect(getTimeline(s, card.id, { cursor })).rejects.toBeInstanceOf(ValidationFailed);
  });
});
