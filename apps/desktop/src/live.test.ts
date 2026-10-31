import type { RealtimeSocket } from '@motes/core';
import { describe, expect, it, vi } from 'vitest';
import { adaptWebSocket, createLiveConnection, websocketUrl } from './live';

class FakeSocket implements RealtimeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

const ping = {
  id: 'evt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  type: 'system.ping',
  occurredAt: '2026-01-01T00:00:00.000Z',
  actor: { kind: 'system' },
  subject: { kind: 'system', id: 'hub' },
  payload: {},
};

describe('desktop live connection', () => {
  it('maps server URLs to websocket URLs', () => {
    expect(websocketUrl('http://localhost:3000/')).toBe('ws://localhost:3000/ws');
    expect(websocketUrl('https://motes.example/')).toBe('wss://motes.example/ws');
  });

  it('follows the stored credential and counts received events', async () => {
    let session: { url: string; token: string } | null = null;
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const live = createLiveConnection({
      session: async () => session,
      socket: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const listener = vi.fn();
    live.subscribe(listener);
    await live.sync();
    expect(live.snapshot()).toEqual({ status: 'offline', eventCount: 0 });
    expect(sockets).toHaveLength(0);

    session = { url: 'http://localhost:3000/', token: 'token' };
    await live.sync();
    const socket = sockets[0];
    if (!socket) throw new Error('Missing socket');
    expect(urls).toEqual(['ws://localhost:3000/ws']);
    expect(live.snapshot().status).toBe('connecting');
    socket.onopen?.();
    expect(live.snapshot().status).toBe('connected');
    expect(JSON.parse(socket.sent[0] ?? '{}')).toEqual({ token: 'token' });
    socket.onmessage?.({ data: JSON.stringify({ seq: '1', event: ping }) });
    await vi.waitFor(() => expect(live.snapshot().eventCount).toBe(1));

    await live.sync();
    expect(sockets).toHaveLength(1);

    session = null;
    await live.sync();
    expect(socket.closed).toBe(true);
    expect(live.snapshot()).toEqual({ status: 'offline', eventCount: 0 });
    expect(listener).toHaveBeenLastCalledWith({ status: 'offline', eventCount: 0 });
  });

  it('starts a fresh connection and counter when the credential changes', async () => {
    let session = { url: 'http://localhost:3000/', token: 'one' };
    const sockets: FakeSocket[] = [];
    const live = createLiveConnection({
      session: async () => session,
      socket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    await live.sync();
    sockets[0]?.onopen?.();
    sockets[0]?.onmessage?.({ data: JSON.stringify({ seq: '1', event: ping }) });
    await vi.waitFor(() => expect(live.snapshot().eventCount).toBe(1));
    session = { url: 'http://localhost:3000/', token: 'two' };
    await live.sync();
    expect(sockets[0]?.closed).toBe(true);
    expect(sockets).toHaveLength(2);
    expect(live.snapshot()).toEqual({ status: 'connecting', eventCount: 0 });
  });

  it('forwards websocket callbacks through the adapter', () => {
    const ws = {
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onmessage: null as ((message: { data: unknown }) => void) | null,
      send: vi.fn(),
      close: vi.fn(),
    };
    const socket = adaptWebSocket(ws as unknown as WebSocket);
    const onmessage = vi.fn();
    const onopen = vi.fn();
    socket.onmessage = onmessage;
    socket.onopen = onopen;
    ws.onopen?.();
    ws.onmessage?.({ data: 'hello' });
    socket.send('x');
    socket.close();
    expect(onopen).toHaveBeenCalled();
    expect(onmessage).toHaveBeenCalledWith({ data: 'hello' });
    expect(ws.send).toHaveBeenCalledWith('x');
    expect(ws.close).toHaveBeenCalled();
  });
});
