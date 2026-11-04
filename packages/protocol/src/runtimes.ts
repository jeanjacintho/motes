import { z } from 'zod';
import { timestampSchema } from './base.js';
import { ENGINE_NAMES } from './bots.js';
import { idSchema } from './ids.js';

/** What the owner calls the machine a daemon token is for; shown in the device list. */
export const createRuntimeTokenBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateRuntimeTokenBody = z.infer<typeof createRuntimeTokenBodySchema>;

/** The token is shown once: only its hash is stored, so it cannot be read again. */
export const runtimeTokenResponseSchema = z.object({
  id: idSchema('device'),
  name: z.string().min(1),
  token: z.string().min(1),
});
export type RuntimeTokenResponse = z.infer<typeof runtimeTokenResponseSchema>;

/** An agent CLI found on a machine: which one, which version, and where. */
export const runtimeEngineSchema = z.object({
  name: z.enum(ENGINE_NAMES),
  version: z.string().trim().min(1).max(100),
  path: z.string().min(1).max(4096),
});
export type RuntimeEngine = z.infer<typeof runtimeEngineSchema>;

/** What a daemon tells the server about its machine, every time it starts. */
export const registerRuntimeBodySchema = z.object({
  machineName: z.string().trim().min(1).max(100),
  os: z.string().trim().min(1).max(100),
  engines: z
    .array(runtimeEngineSchema)
    .max(ENGINE_NAMES.length)
    .refine(
      (engines) => new Set(engines.map((engine) => engine.name)).size === engines.length,
      'List each engine once',
    ),
  /** The most runs this machine may run at once. */
  capacity: z.number().int().min(1).max(64),
});
export type RegisterRuntimeBody = z.infer<typeof registerRuntimeBodySchema>;

/** A machine that runs dev bots. One per daemon token. */
export const runtimeSchema = z.object({
  id: idSchema('runtime'),
  /** The device token the daemon uses, which is how a daemon finds its own runtime again. */
  deviceId: idSchema('device'),
  machineName: z.string().min(1),
  os: z.string().min(1),
  engines: z.array(runtimeEngineSchema),
  capacity: z.number().int().positive(),
  /** Set by registering and by every heartbeat. */
  lastHeartbeatAt: timestampSchema.optional(),
  createdAt: timestampSchema,
});
export type Runtime = z.infer<typeof runtimeSchema>;
