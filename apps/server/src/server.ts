import { readFileSync } from 'node:fs';
import { type Db, migrationsUpToDate } from '@motes/db';
import { pairDevice } from '@motes/domain';
import { pairRequestSchema, pairResponseSchema } from '@motes/protocol';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { Logger } from 'pino';
import { createServices, type Services } from './composition.js';
import { installErrorHandler, route } from './route.js';

const packageInfo = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export function createServer(
  db: Db,
  logger: Logger,
  registerRoutes?: (server: ReturnType<typeof Fastify>, services: Services) => void,
  services: Services = createServices(db),
) {
  const server = Fastify({ loggerInstance: logger as FastifyBaseLogger, bodyLimit: 1024 * 1024 });
  installErrorHandler(server);
  registerRoutes?.(server, services);
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
    return { version: packageInfo.version, uptime: process.uptime(), database, migrations };
  });
  return server;
}
