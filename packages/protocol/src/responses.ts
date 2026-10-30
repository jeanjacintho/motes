import { z } from 'zod';
import { timestampSchema } from './base.js';

export const DEVICE_KINDS = ['client', 'daemon'] as const;
export const healthResponseSchema = z.object({
  version: z.string(),
  uptime: z.number(),
  database: z.boolean(),
  migrations: z.boolean(),
});
export const deviceResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(DEVICE_KINDS),
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
});
export const deviceListResponseSchema = z.array(deviceResponseSchema);
export const revokeDeviceResponseSchema = z.object({ revoked: z.boolean() });
