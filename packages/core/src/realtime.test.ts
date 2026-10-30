import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorageAdapter } from './adapters.js';
import { createQueryClient } from './query-client.js';
import { createRealtime, type RealtimeSocket } from './realtime.js';

class FakeSocket implements RealtimeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const event = {
  id: 'evt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  type: 'system.ping',
  occurredAt: '2026-01-01T00:00:00.000Z',
  actor: { kind: 'system' },
  subject: { kind: 'system', id: 'one' },
  payload: {},
};

describe('realtime', () => {
  it('invalidates registered queries and resumes after the persisted cursor', async () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeSocket[] = [];
      const storage = createMemoryStorageAdapter();
      const queryClient = createQueryClient();
      queryClient.setQueryData(['ping'], 'cached');
      const realtime = createRealtime({
        url: 'ws://test',
        getToken: () => 'token',
        storage,
        queryClient,
        logger: vi.fn(),
        socket: () => {
          const s = new FakeSocket();
          sockets.push(s);
          return s;
        },
      });
      realtime.invalidateOn('system.ping', () => ['ping']);
      await realtime.start();
      const first = sockets[0];
      if (!first) throw new Error('Missing socket');
      first.onopen?.();
      await vi.waitFor(() => expect(first.sent).toHaveLength(1));
      first.message({ seq: '42', event });
      await vi.waitFor(() => expect(queryClient.getQueryState(['ping'])?.isInvalidated).toBe(true));
      await vi.waitFor(async () => expect(await storage.get('realtime.cursor')).toBe('42'));
      first.close();
      await vi.advanceTimersByTimeAsync(1000);
      const second = sockets[1];
      if (!second) throw new Error('Missing reconnect');
      second.onopen?.();
      await vi.waitFor(() =>
        expect(JSON.parse(second.sent[0] ?? '{}')).toEqual({ token: 'token', resumeAfter: '42' }),
      );
      realtime.stop();
    } finally {
      vi.useRealTimers();
    }
  });
  it('invalidates all queries and clears the cursor on resync', async () => {
    const storage = createMemoryStorageAdapter();
    await storage.set('realtime.cursor', '5');
    const queryClient = createQueryClient();
    queryClient.setQueryData(['one'], 1);
    queryClient.setQueryData(['two'], 2);
    const socket = new FakeSocket();
    const realtime = createRealtime({
      url: 'ws://test',
      getToken: () => 'token',
      storage,
      queryClient,
      logger: vi.fn(),
      socket: () => socket,
    });
    await realtime.start();
    socket.onopen?.();
    socket.message({ type: 'resync_required' });
    await vi.waitFor(async () => expect(await storage.get('realtime.cursor')).toBeNull());
    await vi.waitFor(() => expect(queryClient.getQueryState(['two'])?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(['one'])?.isInvalidated).toBe(true);
    realtime.stop();
  });
});
