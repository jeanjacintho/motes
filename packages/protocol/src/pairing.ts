import { z } from 'zod';

export const pairRequestSchema = z.strictObject({
  code: z.string().max(128),
  name: z.string().trim().min(1).max(120),
});
export const pairResponseSchema = z.strictObject({ token: z.string().min(1) });
