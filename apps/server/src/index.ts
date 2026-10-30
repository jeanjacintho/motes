#!/usr/bin/env node
import { createDb, migrate } from '@motes/db';
import { createPairingCode } from '@motes/domain';
import { createServices } from './composition.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const db = createDb(config.databaseUrl);
  if (process.argv[2] === 'pair') {
    try {
      await migrate(db);
      const code = await createPairingCode(createServices(db));
      console.log(`Setup code: ${code} (valid for 10 minutes)`);
    } finally {
      await db.$client.end();
    }
    return;
  }
  const server = createServer(db, logger, undefined, undefined, {
    devRoutes: process.env.MOTES_DEV_ROUTES === 'true',
    replayLimit: config.replayLimit,
  });
  let stopping = false;
  server.addHook('onResponse', async () => {
    // Let Node mark the completed response's socket idle before closing it.
    if (stopping) setImmediate(() => server.server.closeIdleConnections());
  });
  const startup = (async () => {
    if (config.migrateOnStart) await migrate(db);
    const code = await createPairingCode(createServices(db), true);
    if (code) logger.info(`Setup code: ${code} (valid for 10 minutes)`);
    if (!stopping) await server.listen({ port: config.port, host: '0.0.0.0' });
  })();
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      logger.error('Shutdown exceeded five seconds');
      process.exit(1);
    }, 4900);
    deadline.unref();
    try {
      await startup.catch(() => {});
      const draining = server.close();
      server.server.closeIdleConnections();
      await draining;
      await db.$client.end({ timeout: 1 });
      clearTimeout(deadline);
    } catch (error) {
      logger.error({ err: error }, 'Shutdown failed');
      process.exitCode = 1;
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  try {
    await startup;
  } catch (error) {
    logger.error({ err: error }, 'Server startup failed');
    process.exitCode = 1;
    await shutdown();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Invalid configuration');
  process.exitCode = 1;
});
