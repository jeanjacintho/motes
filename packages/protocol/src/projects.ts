import { z } from 'zod';
import { timestampSchema } from './base.js';
import { idSchema } from './ids.js';

/** Short uppercase prefix for human-readable card numbers such as MOT-12. */
export const projectKeySchema = z.string().regex(/^[A-Z]{2,6}$/);
const projectNameSchema = z.string().trim().min(1).max(120);

export const projectSchema = z.object({
  id: idSchema('project'),
  key: projectKeySchema,
  name: projectNameSchema,
  description: z.string().max(10_000),
  defaultRuntimeId: idSchema('runtime').optional(),
  createdAt: timestampSchema,
  archivedAt: timestampSchema.optional(),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectInputSchema = z.strictObject({
  key: projectKeySchema,
  name: projectNameSchema,
  description: z.string().max(10_000).default(''),
  defaultRuntimeId: idSchema('runtime').optional(),
});
export type CreateProjectInput = z.input<typeof createProjectInputSchema>;

export const renameProjectInputSchema = projectNameSchema;
