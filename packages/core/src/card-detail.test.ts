import { newId } from '@motes/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorageAdapter } from './adapters.js';
import { createApiClient } from './api-client.js';
import { labelKeys, registerCardInvalidations } from './cards.js';
import { createQueryClient } from './query-client.js';
import { createRealtime, type RealtimeSocket } from './realtime.js';

const projectId = newId('project');
const label = { id: newId('label'), projectId, name: 'bug', color: '#d73a4a' };

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

describe('label API client', () => {
  it('lists and creates labels, and attaches and detaches them, with encoded ids', async () => {
    const { client, calls } = recordingClient(() => [label]);
    expect(await client.labels.list('prj/1', [])).toEqual([label]);
    await client.labels.create('prj/1', { name: 'bug', color: '#d73a4a' }, null);
    await client.cards.attachLabel('card/1', 'lbl/1', null);
    await client.cards.detachLabel('card/1', 'lbl/1', null);
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['GET', 'http://server/projects/prj%2F1/labels', undefined],
      [
        'POST',
        'http://server/projects/prj%2F1/labels',
        JSON.stringify({ name: 'bug', color: '#d73a4a' }),
      ],
      ['PUT', 'http://server/cards/card%2F1/labels/lbl%2F1', undefined],
      ['DELETE', 'http://server/cards/card%2F1/labels/lbl%2F1', undefined],
    ]);
  });

  it('falls back instead of inventing labels from an unreadable answer', async () => {
    const { client } = recordingClient(() => ({ nope: true }));
    expect(await client.labels.list(projectId, [])).toEqual([]);
    expect(await client.labels.create(projectId, { name: 'x', color: '#000000' }, null)).toBeNull();
    expect(await client.cards.attachLabel('card_1', 'lbl_1', null)).toBeNull();
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

describe('label invalidations', () => {
  it('refreshes the label list of the project a label event names, and no other', async () => {
    const socket = new FakeSocket();
    const queryClient = createQueryClient();
    const other = newId('project');
    queryClient.setQueryData(labelKeys.project(projectId), []);
    queryClient.setQueryData(labelKeys.project(other), []);
    const realtime = createRealtime({
      url: 'ws://test',
      getToken: () => 'token',
      storage: createMemoryStorageAdapter(),
      queryClient,
      logger: vi.fn(),
      socket: () => socket,
    });
    registerCardInvalidations(realtime);
    await realtime.start();
    socket.onmessage?.({
      data: JSON.stringify({
        seq: '1',
        event: {
          id: newId('event'),
          type: 'label.created',
          occurredAt: '2026-10-31T10:00:00.000Z',
          actor: { kind: 'owner' },
          subject: { kind: 'label', id: label.id },
          payload: { projectId },
        },
      }),
    });
    await vi.waitFor(() => expect(realtime.getEventCount()).toBe(1));
    expect(queryClient.getQueryState(labelKeys.project(projectId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(labelKeys.project(other))?.isInvalidated).toBe(false);
    realtime.stop();
  });
});
