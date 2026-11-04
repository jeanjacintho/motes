import { z } from 'zod';
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
