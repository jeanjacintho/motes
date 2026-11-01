import { z } from 'zod';
import { renameProjectInputSchema } from './projects.js';
import {
  localPathSchema,
  repositoryPathSchema,
  repositorySchema,
  updateRepositoryInputSchema,
} from './repositories.js';

export const listProjectsQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const renameProjectBodySchema = z.strictObject({ name: renameProjectInputSchema });

/** Promotion is the only primary change; the old primary is demoted by it. */
export const patchRepositoryBodySchema = updateRepositoryInputSchema.extend({
  isPrimary: z.literal(true).optional(),
});
export type PatchRepositoryBody = z.input<typeof patchRepositoryBodySchema>;

export const setRepositoryPathBodySchema = z.strictObject({ localPath: localPathSchema });

export const repositoryDetailSchema = repositorySchema.extend({
  paths: z.array(repositoryPathSchema.pick({ runtimeId: true, localPath: true })),
});
export type RepositoryDetail = z.infer<typeof repositoryDetailSchema>;

export const removeRepositoryResponseSchema = z.object({ removed: z.boolean() });
