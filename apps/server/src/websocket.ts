import websocket from '@fastify/websocket';
import { readEventsAfter } from '@motes/db';
import { authenticate } from '@motes/domain';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Services } from './composition.js';

const cursor = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const authMessage = z.object({ token: z.string().min(1), resumeAfter: cursor.optional() });
const heartbeatMs = 20_000;

export function registerWebsocket(server: FastifyInstance, services: Services, replayLimit = 5000) {
  if (!Number.isSafeInteger(replayLimit) || replayLimit < 1)
    throw new Error('Invalid replay limit');
  const connections = new Map<string, Set<WebSocket>>();
  const pumps = new Set<() => void>();
  server.register(async (app) => {
    await app.register(websocket, {
      options: { maxPayload: 4096 },
      preClose(done) {
        for (const socket of this.websocketServer.clients) socket.terminate();
        this.websocketServer.close(done);
      },
    });
    const listener = await services.db.$client.listen(
      'motes_events',
      () => {
        for (const pump of pumps) pump();
      },
      () => {
        // Re-read after reconnect as notifications can be lost while disconnected.
        for (const pump of pumps) pump();
      },
    );
    app.addHook('onClose', async () => {
      await listener.unlisten();
    });
    app.get('/ws', { websocket: true }, (socket) => {
      let deviceId: string | undefined;
      let alive = true;
      let authenticating = false;
      let position = 0n;
      let running = false;
      let pending = false;
      let stopped = false;
      const pump = () => {
        pending = true;
        if (running || stopped) return;
        running = true;
        void (async () => {
          while (pending && !stopped) {
            pending = false;
            const batch: Awaited<ReturnType<typeof readEventsAfter>> = [];
            let after = position;
            while (batch.length <= replayLimit) {
              const limit = Math.min(200, replayLimit + 1 - batch.length);
              const page = await readEventsAfter(services.db, after, limit);
              batch.push(...page);
              const last = page.at(-1);
              if (!last || page.length < limit) break;
              after = last.seq;
            }
            if (stopped) break;
            if (batch.length > replayLimit) {
              socket.send(JSON.stringify({ type: 'resync_required' }));
              stopped = true;
              socket.close(1000, 'Resync required');
              break;
            }
            for (const row of batch) {
              if (socket.readyState !== socket.OPEN) break;
              socket.send(JSON.stringify({ seq: row.seq.toString(), event: row.event }));
              position = row.seq;
            }
          }
        })()
          .catch((error: unknown) => {
            server.log.error({ err: error }, 'Event delivery failed');
            socket.terminate();
          })
          .finally(() => {
            running = false;
          });
      };
      const timeout = setTimeout(() => socket.close(1008, 'Authentication required'), heartbeatMs);
      const heartbeat = setInterval(() => {
        if (!alive) return socket.terminate();
        alive = false;
        socket.ping();
      }, heartbeatMs);
      socket.on('pong', () => {
        alive = true;
      });
      socket.on('error', () => socket.terminate());
      socket.on('close', () => {
        stopped = true;
        pumps.delete(pump);
        clearTimeout(timeout);
        clearInterval(heartbeat);
        if (deviceId) {
          const sockets = connections.get(deviceId);
          sockets?.delete(socket);
          if (sockets?.size === 0) connections.delete(deviceId);
        }
      });
      socket.on('message', async (data, isBinary) => {
        if (deviceId) return;
        if (authenticating) return socket.close(1008, 'Authentication required');
        authenticating = true;
        try {
          const parsed = authMessage.safeParse(isBinary ? null : JSON.parse(data.toString()));
          const principal = parsed.success ? await authenticate(services, parsed.data.token) : null;
          if (!principal || !parsed.success || socket.readyState !== socket.OPEN) {
            socket.close(1008, 'Authentication required');
            return;
          }
          clearTimeout(timeout);
          deviceId = principal.deviceId;
          const sockets = connections.get(deviceId) ?? new Set<WebSocket>();
          sockets.add(socket);
          connections.set(deviceId, sockets);
          if (parsed.data.resumeAfter === undefined) {
            const rows = await services.db.$client<
              { seq: string }[]
            >`SELECT COALESCE(MAX(seq), 0)::text AS seq FROM events`;
            position = BigInt(rows[0]?.seq ?? '0');
          } else position = BigInt(parsed.data.resumeAfter);
          if (stopped) return;
          // Events committed after this point are delivered, so clients may report ready.
          socket.send(JSON.stringify({ type: 'ready' }));
          pumps.add(pump);
          pump();
        } catch {
          socket.close(1008, 'Authentication required');
        }
      });
    });
  });
  return connections;
}
