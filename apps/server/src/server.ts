import { readFileSync } from 'node:fs';
import { type Db, migrationsUpToDate } from '@motes/db';
import { authenticate, emitPing, listDevices, pairDevice, revokeDevice } from '@motes/domain';
import {
  deviceListResponseSchema,
  healthResponseSchema,
  pairRequestSchema,
  pairResponseSchema,
  revokeDeviceResponseSchema,
} from '@motes/protocol';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { Logger } from 'pino';
import { z } from 'zod';

declare module 'fastify' {
  interface FastifyRequest {
    principal: { deviceId: string; kind: 'client' | 'daemon' } | null;
  }
}

import { createServices, type Services } from './composition.js';
import { installErrorHandler, route } from './route.js';
import { registerWebsocket } from './websocket.js';

const packageInfo = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export function createServer(
  db: Db,
  logger: Logger,
  registerRoutes?: (server: ReturnType<typeof Fastify>, services: Services) => void,
  services: Services = createServices(db),
  options: { replayLimit?: number; devRoutes?: boolean } = {},
) {
  const server = Fastify({ loggerInstance: logger as FastifyBaseLogger, bodyLimit: 1024 * 1024 });
  installErrorHandler(server);
  server.decorateRequest('principal', null);
  server.addHook('onRequest', async (request, reply) => {
    if (
      (request.method === 'GET' && request.routeOptions.url === '/health') ||
      (request.method === 'GET' &&
        request.routeOptions.url === '/ws' &&
        request.headers.upgrade?.toLowerCase() === 'websocket') ||
      (request.method === 'POST' && request.routeOptions.url === '/pair')
    )
      return;
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
    const principal = match?.[1] ? await authenticate(services, match[1]) : null;
    if (!principal)
      return reply
        .code(401)
        .send({ code: 'unauthorized', message: 'Authentication required', requestId: request.id });
    request.principal = principal;
  });
  const connections = registerWebsocket(server, services, options.replayLimit);
  registerRoutes?.(server, services);
  if (options.devRoutes)
    server.post('/dev/ping', async () => {
      await emitPing(services);
      return { ok: true };
    });
  server.get('/devices', async () => deviceListResponseSchema.parse(await listDevices(services)));
  server.delete('/devices/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    await revokeDevice(services, id);
    return revokeDeviceResponseSchema.parse({ revoked: true });
  });
  route(server, {
    method: 'POST',
    url: '/pair',
    body: pairRequestSchema,
    response: pairResponseSchema,
    handler: async ({ body }) => ({ token: await pairDevice(services, body.code, body.name) }),
  });
  server.get('/health', async (_request, reply) => {
    let database = false;
    let migrations = false;
    try {
      await db.$client`SELECT 1`;
      database = true;
      migrations = await migrationsUpToDate(db);
    } catch (error) {
      logger.error({ err: error }, 'Health check failed');
    }
    if (!database || !migrations) reply.code(503);
    return healthResponseSchema.parse({
      version: packageInfo.version,
      uptime: process.uptime(),
      database,
      migrations,
    });
  });
  return Object.assign(server, { connections });
}
