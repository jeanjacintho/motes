import { z } from 'zod';

/** UTC wire timestamps use the Z suffix; offsets and local times are rejected. */
export const timestampSchema = z.iso.datetime();
export type Timestamp = z.infer<typeof timestampSchema>;

const cursorSchema = z.string().min(1);

export const pageRequestSchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(200),
});
export type PageRequest = z.infer<typeof pageRequestSchema>;

/** A null nextCursor explicitly marks the end of the result set. */
export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    nextCursor: cursorSchema.nullable(),
  });
}
export type Page<Item> = { items: Item[]; nextCursor: string | null };

export const API_ERROR_CODES = Object.freeze([
  'unauthorized',
  'not_found',
  'validation_failed',
  'conflict',
  'rate_limited',
  'internal',
] as const);

export const apiErrorSchema = z.object({
  code: z.enum(API_ERROR_CODES),
  message: z.string().min(1),
  details: z.json().optional(),
  requestId: z.string().min(1),
});
export type ApiErrorCode = z.infer<typeof apiErrorSchema>['code'];
export type ApiError = z.infer<typeof apiErrorSchema>;

const usageCounterSchema = z.number().int().nonnegative();

export const usageSchema = z.object({
  inputTokens: usageCounterSchema,
  outputTokens: usageCounterSchema,
  cachedTokens: usageCounterSchema,
  turns: usageCounterSchema,
  durationMs: usageCounterSchema,
  // Only supplied when reported by the CLI; subscriptions remain the billing source.
  estimatedUsd: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof usageSchema>;
