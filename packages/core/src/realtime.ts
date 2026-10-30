import type { ClientEvent, ParseLogger } from '@motes/protocol';
import { parseClientEvent, parseWithFallback } from '@motes/protocol';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import type { StorageAdapter } from './adapters.js';

export interface RealtimeSocket {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((message: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

type Status = 'offline' | 'connecting' | 'connected' | 'reconnecting';
type Handler = (event: ClientEvent) => void | Promise<void>;
const cursorKey = 'realtime.cursor';
const cursor = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((s) => BigInt(s) <= 9223372036854775807n);
const messageSchema = z
  .union([
    z.object({ type: z.literal('resync_required') }),
    z.object({ seq: cursor, event: z.unknown() }),
  ])
  .nullable();

export function createRealtime(options: {
  url: string;
  getToken: () => string | null | Promise<string | null>;
  storage: StorageAdapter;
  queryClient: QueryClient;
  socket: (url: string) => RealtimeSocket;
  logger: ParseLogger;
}) {
  const handlers = new Map<string, Set<Handler>>();
  const listeners = new Set<() => void>();
  let status: Status = 'offline';
  let current: RealtimeSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let attempts = 0;
  let queue = Promise.resolve();
  const setStatus = (next: Status) => {
    status = next;
    for (const listener of listeners) listener();
  };
  const schedule = () => {
    if (!active || timer) return;
    setStatus('reconnecting');
    timer = setTimeout(
      () => {
        timer = undefined;
        void connect();
      },
      Math.min(1000 * 2 ** attempts++, 30_000),
    );
  };
  async function connect() {
    try {
      await queue;
      if (!active) return;
      const [token, stored] = await Promise.all([
        options.getToken(),
        options.storage.get(cursorKey),
      ]);
      if (!active) return;
      if (!token) {
        schedule();
        return;
      }
      const parsedCursor = cursor.safeParse(stored);
      const socket = options.socket(options.url);
      let halted = false;
      current = socket;
      socket.onopen = () => {
        if (!active || current !== socket) return;
        socket.send(
          JSON.stringify({
            token,
            ...(parsedCursor.success ? { resumeAfter: parsedCursor.data } : {}),
          }),
        );
        setStatus('connected');
      };
      socket.onmessage = ({ data }) => {
        queue = queue
          .then(async () => {
            if (halted) return;
            let raw: unknown;
            try {
              raw = typeof data === 'string' ? JSON.parse(data) : null;
            } catch {
              raw = null;
            }
            const message = parseWithFallback(messageSchema, raw, null, options.logger);
            if (!message) throw new Error('Invalid realtime message');
            if ('type' in message) {
              await options.storage.remove(cursorKey);
              await options.queryClient.invalidateQueries();
              return;
            }
            const event = parseClientEvent(message.event, options.logger);
            if (!event) throw new Error('Invalid realtime event');
            for (const handler of handlers.get(event.type) ?? []) await handler(event);
            await options.storage.set(cursorKey, message.seq);
            attempts = 0;
          })
          .catch(() => {
            halted = true;
            socket.close();
          });
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (current === socket) {
          current = undefined;
          schedule();
        }
      };
    } catch {
      schedule();
    }
  }
  function onEvent(type: string, handler: Handler) {
    const group = handlers.get(type) ?? new Set<Handler>();
    group.add(handler);
    handlers.set(type, group);
    return () => {
      group.delete(handler);
      if (!group.size) handlers.delete(type);
    };
  }
  return {
    async start() {
      if (active) return;
      active = true;
      setStatus('connecting');
      await connect();
    },
    stop() {
      active = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
      current?.close();
      current = undefined;
      setStatus('offline');
    },
    onEvent,
    invalidateOn(type: string, key: (event: ClientEvent) => QueryKey) {
      return onEvent(type, async (event) => {
        await options.queryClient.invalidateQueries({ queryKey: key(event) });
      });
    },
    useConnectionStatus() {
      return useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => status,
        () => 'offline',
      );
    },
  };
}
