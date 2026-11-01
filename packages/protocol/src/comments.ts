import { z } from 'zod';
import { timestampSchema } from './base.js';
import { idSchema } from './ids.js';

/** Markdown; it must say something, and the limit keeps one comment from becoming a document. */
export const commentBodySchema = z
  .string()
  .max(20_000)
  .refine((body) => body.trim().length > 0, 'A comment cannot be blank');

export const commentAuthorSchema = z.object({
  type: z.enum(['owner', 'bot']),
  id: z.string().min(1),
});

export const commentSchema = z.object({
  id: idSchema('comment'),
  cardId: idSchema('card'),
  author: commentAuthorSchema,
  body: commentBodySchema,
  createdAt: timestampSchema,
  /** Present once the author has changed the body. */
  editedAt: timestampSchema.optional(),
});
export type Comment = z.infer<typeof commentSchema>;

export const commentInputSchema = z.object({ body: commentBodySchema });
export type CommentInput = z.infer<typeof commentInputSchema>;
