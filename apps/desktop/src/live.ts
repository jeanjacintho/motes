import {
  createMemoryStorageAdapter,
  createQueryClient,
  createRealtime,
  type RealtimeSocket,
} from '@motes/core';

export type LiveSnapshot = {
  status: 'offline' | 'connecting' | 'connected' | 'reconnecting';
  eventCount: number;
};

const offline: LiveSnapshot = { status: 'offline', eventCount: 0 };

export function websocketUrl(serverUrl: string): string {
  const url = new URL('/ws', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

export function adaptWebSocket(ws: WebSocket): RealtimeSocket {
  const socket: RealtimeSocket = {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
  ws.onopen = () => socket.onopen?.();
  ws.onclose = () => socket.onclose?.();
  ws.onerror = () => socket.onerror?.();
  ws.onmessage = (message) => socket.onmessage?.({ data: message.data });
  return socket;
}

// Realtime runs in the main process so the device token never reaches the renderer.
export function createLiveConnection(options: {
  // Receives sanitized text only: never credentials, frames or payloads.
  diagnostic: (message: string) => void;
  session: () => Promise<{ url: string; token: string } | null>;
  socket: (url: string) => RealtimeSocket;
}) {
  let current: { key: string; stop: () => void } | undefined;
  let snapshot = offline;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<(snapshot: LiveSnapshot) => void>();
  function publish(next: LiveSnapshot) {
    if (next.status === snapshot.status && next.eventCount === snapshot.eventCount) return;
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  }
  async function reconcile() {
    const session = await options.session();
    const key = session ? `${session.url}\n${session.token}` : null;
    if (current?.key === key) return;
    current?.stop();
    current = undefined;
    publish(offline);
    if (!session) return;
    const realtime = createRealtime({
      url: websocketUrl(session.url),
      getToken: () => session.token,
      storage: createMemoryStorageAdapter(),
      queryClient: createQueryClient(),
      socket: options.socket,
      logger: (error) =>
        options.diagnostic(
          `Incompatible realtime message: ${error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.code}`)
            .join(', ')}`,
        ),
    });
    const read = () =>
      publish({ status: realtime.getStatus(), eventCount: realtime.getEventCount() });
    const unsubscribe = realtime.subscribe(read);
    current = {
      key: key ?? '',
      stop: () => {
        unsubscribe();
        realtime.stop();
      },
    };
    await realtime.start();
    read();
  }
  return {
    // Align the connection with the stored credential after pairing changes.
    sync(): Promise<void> {
      const result = queue.then(reconcile).catch((error: unknown) => {
        // The error name only: messages from JSON parsing can quote the stored credential.
        options.diagnostic(
          `Live sync failed: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      });
      queue = result;
      return result;
    },
    snapshot: () => snapshot,
    subscribe(listener: (snapshot: LiveSnapshot) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
