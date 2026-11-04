import { newId } from '@motes/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorageAdapter } from './adapters.js';
import { createApiClient } from './api-client.js';
import { botKeys, botQueryOptions, botsQueryOptions, registerBotInvalidations } from './bots.js';
import { createQueryClient } from './query-client.js';
import { createRealtime, type RealtimeSocket } from './realtime.js';

const summary = {
  id: newId('bot'),
  slug: 'dev',
  displayName: 'Dev',
  kind: 'dev',
  engines: ['claude'],
  enabled: true,
  skillDigest: 'a'.repeat(64),
};

function recordingClient(body: unknown) {
  const calls: string[] = [];
  const client = createApiClient({
    baseUrl: 'http://server/',
    getToken: () => 'token',
    fetch: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => body };
    },
    logger: vi.fn(),
  });
  return { client, calls };
}

describe('bot API client', () => {
  it('lists bots and falls back to an empty list on an unreadable answer', async () => {
    const { client, calls } = recordingClient([summary]);
    expect(await client.bots.list([])).toEqual([summary]);
    expect(calls).toEqual(['http://server/bots']);
    expect(await recordingClient({ nope: 1 }).client.bots.list([])).toEqual([]);
  });

  it('gets one bot by encoded id, with null for an unreadable answer', async () => {
    const detail = { ...summary, config: null, skill: null, skillSource: null, references: [] };
    const { client, calls } = recordingClient(detail);
    expect(await client.bots.get('bot/1', null)).toEqual(detail);
    expect(calls).toEqual(['http://server/bots/bot%2F1']);
    expect(await recordingClient({ id: 1 }).client.bots.get('x', null)).toBeNull();
  });

  it('keys the queries so one invalidation reaches the list and every detail', () => {
    const { client } = recordingClient([]);
    expect(botsQueryOptions(client).queryKey).toEqual(['bots']);
    expect(botQueryOptions(client, summary.id).queryKey).toEqual(['bots', summary.id]);
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

describe('bot invalidations', () => {
  it('refreshes the bot queries on bot events until cleaned up', async () => {
    const socket = new FakeSocket();
    const queryClient = createQueryClient();
    queryClient.setQueryData(botKeys.all, []);
    queryClient.setQueryData(botKeys.bot(summary.id), null);
    const realtime = createRealtime({
      url: 'ws://test',
      getToken: () => 'token',
      storage: createMemoryStorageAdapter(),
      queryClient,
      logger: vi.fn(),
      socket: () => socket,
    });
    const stop = registerBotInvalidations(realtime);
    await realtime.start();
    let seq = 0;
    const deliver = async (type: string) => {
      const event = {
        id: newId('event'),
        type,
        occurredAt: '2026-10-31T10:00:00.000Z',
        actor: { kind: 'system' },
        subject: { kind: 'bot', id: summary.id },
        payload: { slug: 'dev' },
      };
      socket.onmessage?.({ data: JSON.stringify({ seq: String(++seq), event }) });
      await vi.waitFor(() => expect(realtime.getEventCount()).toBe(seq));
    };
    const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    await deliver('bot.updated');
    expect(stale(botKeys.all)).toBe(true);
    expect(stale(botKeys.bot(summary.id))).toBe(true);
    queryClient.setQueryData(botKeys.all, []);
    stop();
    await deliver('bot.removed');
    expect(stale(botKeys.all)).toBe(false);
    realtime.stop();
  });
});

describe('bot write calls', () => {
  function recording(respond: (url: string) => unknown) {
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
  const detail = { ...summary, config: null, skill: null, skillSource: null, references: [] };
  const commit = 'a'.repeat(40);

  it('sends each write to its route with encoded ids and JSON bodies', async () => {
    const { client, calls } = recording(() => detail);
    await client.bots.create({ slug: 'qa', displayName: 'QA', kind: 'dev' }, null);
    await client.bots.updateSkill('bot/1', '---\nname: x\n---\n', null);
    await client.bots.updateConfig('bot/1', { enabled: false }, null);
    await client.bots.revert('bot/1', commit, null);
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      [
        'POST',
        'http://server/bots',
        JSON.stringify({ slug: 'qa', displayName: 'QA', kind: 'dev' }),
      ],
      ['PUT', 'http://server/bots/bot%2F1/skill', JSON.stringify({ skill: '---\nname: x\n---\n' })],
      ['PATCH', 'http://server/bots/bot%2F1/config', JSON.stringify({ enabled: false })],
      ['POST', `http://server/bots/bot%2F1/revert/${commit}`, undefined],
    ]);
  });

  it('reads history and removes a bot, with fallbacks for unreadable answers', async () => {
    const entry = {
      commit,
      message: 'bot(dev): create',
      author: 'Motes',
      committedAt: '2026-10-31T10:00:00Z',
    };
    const { client, calls } = recording((url) =>
      url.endsWith('/history') ? [entry] : { removed: true },
    );
    expect(await client.bots.history('bot/1', [])).toEqual([entry]);
    expect(await client.bots.remove('bot/1', { removed: false })).toEqual({ removed: true });
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', 'http://server/bots/bot%2F1/history'],
      ['DELETE', 'http://server/bots/bot%2F1'],
    ]);
    const broken = recording(() => ({ nope: 1 })).client;
    expect(await broken.bots.history('bot_1', [])).toEqual([]);
    expect(await broken.bots.remove('bot_1', { removed: false })).toEqual({ removed: false });
    expect(await broken.bots.create({ slug: 'x', displayName: 'X', kind: 'dev' }, null)).toBeNull();
  });

  it('keys a bot history under the bot, so any bot event refreshes it', () => {
    expect(botKeys.history('bot_1')).toEqual(['bots', 'bot_1', 'history']);
  });
});
