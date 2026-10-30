import { readFileSync } from 'node:fs';
import { type Db, migrationsUpToDate } from '@motes/db';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { Logger } from 'pino';
import { createServices, type Services } from './composition.js';
import { installErrorHandler } from './route.js';

const packageInfo = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export function createServer(
  db: Db,
  logger: Logger,
  registerRoutes?: (server: ReturnType<typeof Fastify>, services: Services) => void,
) {
  const server = Fastify({ loggerInstance: logger as FastifyBaseLogger, bodyLimit: 1024 * 1024 });
  installErrorHandler(server);
  registerRoutes?.(server, createServices(db));
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
