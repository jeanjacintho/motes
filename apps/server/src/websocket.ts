import websocket from '@fastify/websocket';
import { authenticate } from '@motes/domain';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Services } from './composition.js';

const authMessage = z.object({ token: z.string().min(1) });
const heartbeatMs = 20_000;

export function registerWebsocket(server: FastifyInstance, services: Services) {
  const connections = new Map<string, Set<WebSocket>>();
  server.register(async (app) => {
    await app.register(websocket, { options: { maxPayload: 4096 } });
    app.get('/ws', { websocket: true }, (socket) => {
      let deviceId: string | undefined;
      let alive = true;
      let authenticating = false;
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
          if (!principal || socket.readyState !== socket.OPEN) {
            socket.close(1008, 'Authentication required');
            return;
          }
          clearTimeout(timeout);
          deviceId = principal.deviceId;
          const sockets = connections.get(deviceId) ?? new Set<WebSocket>();
          sockets.add(socket);
          connections.set(deviceId, sockets);
        } catch {
          socket.close(1008, 'Authentication required');
        }
      });
    });
    app.addHook('onClose', async () => {
      for (const sockets of connections.values()) for (const socket of sockets) socket.terminate();
    });
  });
  return connections;
}
