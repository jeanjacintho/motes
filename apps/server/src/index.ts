import { createDb, migrate } from '@motes/db';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const db = createDb(config.databaseUrl);
  const server = createServer(db, logger);
  let stopping = false;
  const startup = (async () => {
    if (config.migrateOnStart) await migrate(db);
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
      await server.close();
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
