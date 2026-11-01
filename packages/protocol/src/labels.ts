import { z } from 'zod';
import { idSchema } from './ids.js';

const labelNameSchema = z.string().trim().min(1).max(40);
const labelColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);

export const labelSchema = z.object({
  id: idSchema('label'),
  projectId: idSchema('project'),
  name: labelNameSchema,
  /** Lowercase hex such as #d73a4a. */
  color: labelColorSchema,
});
export type Label = z.infer<typeof labelSchema>;

export const createLabelInputSchema = z.object({
  name: labelNameSchema,
  color: labelColorSchema,
});
export type CreateLabelInput = z.infer<typeof createLabelInputSchema>;

export const updateLabelInputSchema = z.object({
  name: labelNameSchema.optional(),
  color: labelColorSchema.optional(),
});
export type UpdateLabelInput = z.infer<typeof updateLabelInputSchema>;
