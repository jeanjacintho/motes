import { z } from 'zod';
import { idSchema } from './ids.js';

const nameSchema = z.string().trim().min(1).max(120);
// Git remotes include scp-like forms such as git@host:owner/repo.git, so this is not a URL.
const remoteUrlSchema = z.string().trim().min(1).max(2048);
const branchSchema = z.string().min(1).max(255).regex(/^\S+$/);

export const repositorySchema = z.object({
  id: idSchema('repository'),
  projectId: idSchema('project'),
  name: nameSchema,
  remoteUrl: remoteUrlSchema,
  defaultBranch: branchSchema,
  isPrimary: z.boolean(),
});
export type Repository = z.infer<typeof repositorySchema>;

/** Where one runtime keeps its checkout of a repository. */
export const localPathSchema = z
  .string()
  .max(4096)
  .regex(/^\/[^\0]*$/);

export const repositoryPathSchema = z.object({
  repositoryId: idSchema('repository'),
  runtimeId: idSchema('runtime'),
  localPath: localPathSchema,
});
export type RepositoryPath = z.infer<typeof repositoryPathSchema>;

export const addRepositoryInputSchema = z.strictObject({
  name: nameSchema,
  remoteUrl: remoteUrlSchema,
  defaultBranch: branchSchema,
});
export type AddRepositoryInput = z.input<typeof addRepositoryInputSchema>;

export const updateRepositoryInputSchema = addRepositoryInputSchema.partial();
export type UpdateRepositoryInput = z.input<typeof updateRepositoryInputSchema>;
