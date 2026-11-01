import type { Board, Card } from '@motes/protocol';
import { newId } from '@motes/protocol';
import { MutationObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorageAdapter } from './adapters.js';
import { ApiError, createApiClient } from './api-client.js';
import {
  applyMove,
  boardQueryOptions,
  cardKeys,
  cardQueryOptions,
  moveCardMutationOptions,
  registerCardInvalidations,
} from './cards.js';
import { createQueryClient } from './query-client.js';
import { createRealtime, type RealtimeSocket } from './realtime.js';

const projectId = newId('project');
const makeCard = (title: string, status: Card['status'] = 'backlog'): Card => ({
  id: newId('card'),
  projectId,
  number: 1,
  title,
  description: '',
  status,
  priority: 'none',
  labels: [],
  createdBy: { type: 'owner', id: 'owner' },
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
});

function boardOf(columns: Partial<Record<Card['status'], Card[]>>): Board {
  const statuses = [
    'backlog',
    'todo',
    'in_progress',
    'in_review',
    'done',
    'blocked',
    'cancelled',
  ] as const;
  return { columns: statuses.map((status) => ({ status, cards: columns[status] ?? [] })) };
}

const titles = (board: Board, status: Card['status']) =>
  board.columns.find((column) => column.status === status)?.cards.map((card) => card.title);

function recordingClient(respond: (url: string, init: { method: string }) => unknown) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const client = createApiClient({
    baseUrl: 'http://server/',
    getToken: () => 'token',
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      const result = respond(url, init) as { status?: number; body: unknown };
      const status = result.status ?? 200;
      return { ok: status < 400, status, json: async () => result.body };
    },
    logger: vi.fn(),
  });
  return { client, calls };
}

describe('card API client', () => {
  const card = makeCard('x');

  it('reads, writes and moves cards with encoded ids and JSON bodies', async () => {
    const { client, calls } = recordingClient(() => ({ body: card }));
    expect(await client.cards.get('MOT-1', null)).toEqual(card);
    await client.cards.create('prj/1', { title: 'x' }, null);
    await client.cards.update('card/1', { title: 'y' }, null);
    await client.cards.move('card/1', { status: 'todo', afterId: card.id }, null);
    await client.cards.assign('card/1', { assignee: null }, null);
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['GET', 'http://server/cards/MOT-1', undefined],
      ['POST', 'http://server/projects/prj%2F1/cards', JSON.stringify({ title: 'x' })],
      ['PATCH', 'http://server/cards/card%2F1', JSON.stringify({ title: 'y' })],
      [
        'POST',
        'http://server/cards/card%2F1/move',
        JSON.stringify({ status: 'todo', afterId: card.id }),
      ],
      ['POST', 'http://server/cards/card%2F1/assign', JSON.stringify({ assignee: null })],
    ]);
  });

  it('puts the board filters in the query string and falls back to an empty board', async () => {
    const board = boardOf({ backlog: [card] });
    const { client, calls } = recordingClient(() => ({ body: board }));
    expect(
      await client.cards.board(
        projectId,
        { priority: 'high', assignee: { type: 'bot', id: 'bot_1' }, text: 'a b' },
        { columns: [] },
      ),
    ).toEqual(board);
    await client.cards.board(projectId, {}, { columns: [] });
    expect(calls.map((call) => call.url)).toEqual([
      `http://server/projects/${projectId}/board?priority=high&text=a+b&assignee=bot%3Abot_1`,
      `http://server/projects/${projectId}/board`,
    ]);
    const broken = recordingClient(() => ({ body: { columns: 'nope' } }));
    expect(await broken.client.cards.board(projectId, {}, { columns: [] })).toEqual({
      columns: [],
    });
    const unreadable = recordingClient(() => ({ body: { id: 1 } }));
    expect(await unreadable.client.cards.get('MOT-1', null)).toBeNull();
  });

  it('exposes query options keyed by project, filters and reference', () => {
    const { client } = recordingClient(() => ({ body: card }));
    expect(boardQueryOptions(client, projectId, { priority: 'high' }).queryKey).toEqual(
      cardKeys.board(projectId, { priority: 'high' }),
    );
    expect(cardQueryOptions(client, 'MOT-1').queryKey).toEqual(['cards', 'MOT-1']);
  });
});

describe('applyMove', () => {
  const a = makeCard('a');
  const b = makeCard('b');
  const c = makeCard('c');
  const d = makeCard('d', 'todo');
  const board = boardOf({ backlog: [a, b, c], todo: [d] });

  it('lands directly below afterId, directly above beforeId, or at the bottom', () => {
    expect(
      titles(applyMove(board, { cardId: c.id, status: 'backlog', afterId: a.id }), 'backlog'),
    ).toEqual(['a', 'c', 'b']);
    expect(
      titles(applyMove(board, { cardId: c.id, status: 'backlog', beforeId: a.id }), 'backlog'),
    ).toEqual(['c', 'a', 'b']);
    expect(titles(applyMove(board, { cardId: a.id, status: 'backlog' }), 'backlog')).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('moves across columns and updates the status', () => {
    const moved = applyMove(board, { cardId: a.id, status: 'todo', beforeId: d.id });
    expect(titles(moved, 'backlog')).toEqual(['b', 'c']);
    expect(titles(moved, 'todo')).toEqual(['a', 'd']);
    expect(moved.columns.find((column) => column.status === 'todo')?.cards[0]?.status).toBe('todo');
    expect(titles(board, 'backlog')).toEqual(['a', 'b', 'c']);
  });

  it('leaves a board that does not hold the card untouched', () => {
    const filtered = boardOf({ backlog: [a] });
    expect(applyMove(filtered, { cardId: c.id, status: 'todo' })).toBe(filtered);
  });
});

describe('move mutation', () => {
  const a = makeCard('a');
  const b = makeCard('b');
  const board = boardOf({ backlog: [a, b] });

  function setup(respond: Parameters<typeof recordingClient>[0]) {
    const { client } = recordingClient(respond);
    const queryClient = createQueryClient();
    const filtered = cardKeys.board(projectId, { priority: 'high' });
    queryClient.setQueryData(cardKeys.board(projectId, {}), board);
    queryClient.setQueryData(filtered, boardOf({ backlog: [a] }));
    const observer = new MutationObserver(
      queryClient,
      moveCardMutationOptions(client, queryClient),
    );
    return { queryClient, observer, filtered };
  }
  const read = (queryClient: ReturnType<typeof createQueryClient>, key: readonly unknown[]) =>
    queryClient.getQueryData<Board>(key);

  it('shows the move at once on every cached board of the project', async () => {
    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { queryClient, observer, filtered } = setup(() => gate as never);
    // The request hangs, so what the cache shows now is purely the optimistic state.
    const pending = observer.mutate({ projectId, cardId: a.id, status: 'todo' });
    await vi.waitFor(() =>
      expect(titles(read(queryClient, cardKeys.board(projectId, {})) as Board, 'todo')).toEqual([
        'a',
      ]),
    );
    expect(titles(read(queryClient, filtered) as Board, 'todo')).toEqual(['a']);
    release({ body: { ...a, status: 'todo' } });
    await pending;
  });

  it('puts the snapshots back when the move fails, then refetches', async () => {
    const { queryClient, observer, filtered } = setup(() => ({
      status: 409,
      body: { code: 'conflict', message: 'No', requestId: 'r1' },
    }));
    const invalidated = vi.spyOn(queryClient, 'invalidateQueries');
    await expect(
      observer.mutate({ projectId, cardId: a.id, status: 'done' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(read(queryClient, cardKeys.board(projectId, {}))).toEqual(board);
    expect(read(queryClient, filtered)).toEqual(boardOf({ backlog: [a] }));
    expect(invalidated).toHaveBeenCalledWith({ queryKey: cardKeys.boards(projectId) });
  });

  it('refetches after a successful move so the server has the last word', async () => {
    const { queryClient, observer } = setup(() => ({ body: { ...a, status: 'todo' } }));
    await observer.mutate({ projectId, cardId: a.id, status: 'todo' });
    expect(queryClient.getQueryState(cardKeys.board(projectId, {}))?.isInvalidated).toBe(true);
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

describe('card invalidations', () => {
  async function setup() {
    const socket = new FakeSocket();
    const queryClient = createQueryClient();
    const other = newId('project');
    queryClient.setQueryData(cardKeys.board(projectId, {}), boardOf({}));
    queryClient.setQueryData(cardKeys.board(projectId, { priority: 'high' }), boardOf({}));
    queryClient.setQueryData(cardKeys.board(other, {}), boardOf({}));
    queryClient.setQueryData(cardKeys.card('MOT-1'), null);
    const realtime = createRealtime({
      url: 'ws://test',
      getToken: () => 'token',
      storage: createMemoryStorageAdapter(),
      queryClient,
      logger: vi.fn(),
      socket: () => socket,
    });
    const stop = registerCardInvalidations(realtime);
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
        occurredAt: '2026-10-31T10:00:00.000Z',
        actor: { kind: 'owner' },
        subject,
        payload,
      };
      socket.onmessage?.({ data: JSON.stringify({ seq: String(++seq), event }) });
      await vi.waitFor(() => expect(realtime.getEventCount()).toBe(seq));
    };
    const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    return { deliver, stale, other, stop, realtime };
  }

  it('refreshes every board of the affected project and the card details on card events', async () => {
    const { deliver, stale, other, realtime } = await setup();
    await deliver('card.moved', { kind: 'card', id: newId('card') }, { projectId, status: 'todo' });
    expect(stale(cardKeys.board(projectId, {}))).toBe(true);
    expect(stale(cardKeys.board(projectId, { priority: 'high' }))).toBe(true);
    expect(stale(cardKeys.card('MOT-1'))).toBe(true);
    expect(stale(cardKeys.board(other, {}))).toBe(false);
    realtime.stop();
  });

  it('refreshes the boards when a label changes, and stops after the cleanup', async () => {
    const { deliver, stale, stop, realtime } = await setup();
    await deliver('label.deleted', { kind: 'label', id: newId('label') }, { projectId });
    expect(stale(cardKeys.board(projectId, {}))).toBe(true);
    expect(stale(cardKeys.card('MOT-1'))).toBe(false);
    stop();
    await deliver('card.deleted', { kind: 'card', id: newId('card') }, { projectId });
    expect(stale(cardKeys.card('MOT-1'))).toBe(false);
    realtime.stop();
  });
});
