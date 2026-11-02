import { newId, type TimelineItem } from '@motes/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorageAdapter } from './adapters.js';
import { createApiClient } from './api-client.js';
import { createQueryClient } from './query-client.js';
import { createRealtime, type RealtimeSocket } from './realtime.js';
import { registerTimelineInvalidations, timelineKeys, timelineQueryOptions } from './timeline.js';

const cardId = newId('card');
const at = '2026-10-31T10:00:00.000Z';
const commentItem = (body: string): TimelineItem => ({
  kind: 'comment',
  at,
  comment: {
    id: newId('comment'),
    cardId,
    author: { type: 'owner', id: 'owner' },
    body,
    createdAt: at,
  },
});
const activityItem: TimelineItem = {
  kind: 'activity',
  at,
  entry: {
    id: newId('event'),
    cardId,
    type: 'card.created',
    actor: { kind: 'owner' },
    payload: {},
    occurredAt: at,
  },
};

function recordingClient(respond: (url: string) => unknown) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const client = createApiClient({
    baseUrl: 'http://server/',
    getToken: () => 'token',
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return { ok: true, status: 200, json: async () => respond(url) };
    },
    logger: vi.fn(),
  });
  return { client, calls };
}

describe('timeline API client', () => {
  it('sends the cursor and limit, and writes comments with encoded ids', async () => {
    const { client, calls } = recordingClient(() => ({ items: [], nextCursor: null }));
    await client.comments.timeline('card/1', {}, { items: [], nextCursor: null });
    await client.comments.timeline(
      'card/1',
      { cursor: 'a b', limit: 20 },
      { items: [], nextCursor: null },
    );
    await client.comments.add('card/1', { body: 'oi' }, null);
    await client.comments.edit('cmt/1', { body: 'tchau' }, null);
    await client.comments.remove('cmt/1', { deleted: true });
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['GET', 'http://server/cards/card%2F1/timeline', undefined],
      ['GET', 'http://server/cards/card%2F1/timeline?cursor=a+b&limit=20', undefined],
      ['POST', 'http://server/cards/card%2F1/comments', JSON.stringify({ body: 'oi' })],
      ['PATCH', 'http://server/comments/cmt%2F1', JSON.stringify({ body: 'tchau' })],
      ['DELETE', 'http://server/comments/cmt%2F1', undefined],
    ]);
  });

  it('keeps the lines it understands and skips a kind it does not know', async () => {
    const comment = commentItem('oi');
    const { client } = recordingClient(() => ({
      items: [comment, { kind: 'run', at, run: {} }, activityItem, { nonsense: true }],
      nextCursor: 'next',
    }));
    expect(await client.comments.timeline(cardId, {}, { items: [], nextCursor: null })).toEqual({
      items: [comment, activityItem],
      nextCursor: 'next',
    });
  });

  it('falls back to an empty page when the page itself is unreadable', async () => {
    const { client } = recordingClient(() => ({ items: 'nope' }));
    expect(await client.comments.timeline(cardId, {}, { items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(
      await recordingClient(() => ({ id: 1 })).client.comments.add(cardId, { body: 'x' }, null),
    ).toBeNull();
  });
});

describe('timeline queries', () => {
  it('follows the cursor from page to page until the server stops sending one', async () => {
    const first = [commentItem('a')];
    const second = [commentItem('b')];
    const { client, calls } = recordingClient((url) =>
      url.includes('cursor=c1')
        ? { items: second, nextCursor: null }
        : { items: first, nextCursor: 'c1' },
    );
    const queryClient = createQueryClient();
    const options = timelineQueryOptions(client, cardId, 1);
    const data = await queryClient.fetchInfiniteQuery({ ...options, pages: 2 });
    expect(data.pages.flatMap((page) => page.items)).toEqual([...first, ...second]);
    expect(calls.map((call) => call.url)).toEqual([
      `http://server/cards/${cardId}/timeline?limit=1`,
      `http://server/cards/${cardId}/timeline?cursor=c1&limit=1`,
    ]);
  });
});

class FakeSocket implements RealtimeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  send() {}
  close() {}
}

describe('timeline invalidations', () => {
  async function setup() {
    const socket = new FakeSocket();
    const queryClient = createQueryClient();
    const otherCard = newId('card');
    queryClient.setQueryData(timelineKeys.card(cardId), { pages: [], pageParams: [] });
    queryClient.setQueryData(timelineKeys.card(otherCard), { pages: [], pageParams: [] });
    const realtime = createRealtime({
      url: 'ws://test',
      getToken: () => 'token',
      storage: createMemoryStorageAdapter(),
      queryClient,
      logger: vi.fn(),
      socket: () => socket,
    });
    registerTimelineInvalidations(realtime);
    await realtime.start();
    let seq = 0;
    const deliver = async (
      type: string,
      subject: { kind: string; id: string },
      payload: object,
    ) => {
      const event = {
        id: newId('event'),
        type,
        occurredAt: at,
        actor: { kind: 'owner' },
        subject,
        payload,
      };
      socket.onmessage?.({ data: JSON.stringify({ seq: String(++seq), event }) });
      await vi.waitFor(() => expect(realtime.getEventCount()).toBe(seq));
    };
    const stale = (id: string) => queryClient.getQueryState(timelineKeys.card(id))?.isInvalidated;
    return { deliver, stale, otherCard, realtime };
  }

  it.each(['comment.created', 'comment.updated', 'comment.deleted'])(
    'refreshes only the card named by %s',
    async (type) => {
      const { deliver, stale, otherCard, realtime } = await setup();
      await deliver(
        type,
        { kind: 'comment', id: newId('comment') },
        { projectId: newId('project'), cardId },
      );
      expect(stale(cardId)).toBe(true);
      expect(stale(otherCard)).toBe(false);
      realtime.stop();
    },
  );

  const project = newId('project');
  // Events that do not parse are answered by refreshing everything, so these must be valid.
  const activityPayloads: Record<string, object> = {
    'card.created': { projectId: project, number: 1 },
    'card.updated': { projectId: project, changed: ['title'] },
    'card.assigned': { projectId: project, assignee: null },
    'card.status_changed': { projectId: project, from: 'backlog', to: 'todo', reason: null },
    'card.labels_changed': { projectId: project, labelIds: [] },
    'card.deleted': { projectId: project },
  };

  it.each(Object.keys(activityPayloads))('refreshes the card that %s happened to', async (type) => {
    const { deliver, stale, otherCard, realtime } = await setup();
    await deliver(type, { kind: 'card', id: cardId }, activityPayloads[type] ?? {});
    expect(stale(cardId)).toBe(true);
    expect(stale(otherCard)).toBe(false);
    realtime.stop();
  });

  it('ignores events that leave no timeline line, such as a card move', async () => {
    const { deliver, stale, realtime } = await setup();
    await deliver(
      'card.moved',
      { kind: 'card', id: cardId },
      { projectId: project, status: 'todo' },
    );
    expect(stale(cardId)).toBe(false);
    realtime.stop();
  });
});
