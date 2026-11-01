import { z } from 'zod';
import { timestampSchema } from './base.js';
import { idSchema } from './ids.js';
import { projectKeySchema } from './projects.js';

export const CARD_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
] as const;
export const CARD_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
/** The largest value of the PostgreSQL integer column that stores card numbers. */
export const MAX_CARD_NUMBER = 2_147_483_647;
export type CardStatus = (typeof CARD_STATUSES)[number];
export type CardPriority = (typeof CARD_PRIORITIES)[number];

/** The owner is the only human, so its id is the constant "owner". */
const principalSchema = <Type extends z.ZodType>(types: Type) =>
  z.object({ type: types, id: z.string().min(1) });
export const cardAssigneeSchema = principalSchema(z.enum(['owner', 'bot']));
export const cardCreatorSchema = principalSchema(z.enum(['owner', 'bot', 'system']));

export const cardSchema = z.object({
  id: idSchema('card'),
  projectId: idSchema('project'),
  /** Per-project sequence, shown as KEY-number. */
  number: z.number().int().positive().max(MAX_CARD_NUMBER),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(100_000),
  status: z.enum(CARD_STATUSES),
  priority: z.enum(CARD_PRIORITIES),
  assignee: cardAssigneeSchema.optional(),
  repositoryId: idSchema('repository').optional(),
  labels: z.array(z.string()),
  createdBy: cardCreatorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Card = z.infer<typeof cardSchema>;

export const createCardInputSchema = z.object({
  title: cardSchema.shape.title,
  description: cardSchema.shape.description.default(''),
  priority: cardSchema.shape.priority.default('none'),
  /** Defaults to the project's primary repository. */
  repositoryId: idSchema('repository').optional(),
  assignee: cardAssigneeSchema.optional(),
});
export type CreateCardInput = z.input<typeof createCardInputSchema>;

/** Only the fields present are changed; status and assignee have their own operations. */
export const updateCardInputSchema = z.object({
  title: cardSchema.shape.title.optional(),
  description: cardSchema.shape.description.optional(),
  priority: cardSchema.shape.priority.optional(),
  repositoryId: idSchema('repository').optional(),
});
export type UpdateCardInput = z.infer<typeof updateCardInputSchema>;

/** A null assignee clears the assignment. */
export const assignCardInputSchema = cardAssigneeSchema.nullable();

export const changeStatusInputSchema = z.object({
  to: z.enum(CARD_STATUSES),
  reason: z.string().trim().min(1).max(1000).optional(),
});
export type ChangeStatusInput = z.infer<typeof changeStatusInputSchema>;

export function cardRef(key: string, number: number): string {
  return `${key}-${number}`;
}

/** Parses "MOT-12"; numbers start at 1 and have no leading zeros. */
export function parseCardRef(ref: string): { key: string; number: number } | null {
  const match = /^([A-Z]{2,6})-([1-9][0-9]*)$/.exec(ref);
  const key = projectKeySchema.safeParse(match?.[1]);
  const number = Number(match?.[2]);
  return key.success && Number.isSafeInteger(number) && number <= MAX_CARD_NUMBER
    ? { key: key.data, number }
    : null;
}
