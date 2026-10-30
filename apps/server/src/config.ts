import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MOTES_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MOTES_DATA_DIR: z
    .string()
    .min(1)
    .default(join(homedir(), 'Library', 'Application Support', 'Motes')),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  return {
    databaseUrl: result.data.DATABASE_URL,
    port: result.data.MOTES_PORT,
    dataDir: result.data.MOTES_DATA_DIR,
    logLevel: result.data.LOG_LEVEL,
  };
}
