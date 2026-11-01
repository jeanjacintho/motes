import { describe, expect, test } from 'vitest';
import {
  listProjectsQuerySchema,
  newId,
  patchRepositoryBodySchema,
  renameProjectBodySchema,
  repositoryDetailSchema,
  setRepositoryPathBodySchema,
} from './index.js';

describe('project API contracts', () => {
  test('parses the includeArchived query flag from its string form', () => {
    expect(listProjectsQuerySchema.parse({})).toEqual({ includeArchived: false });
    expect(listProjectsQuerySchema.parse({ includeArchived: 'true' })).toEqual({
      includeArchived: true,
    });
    expect(listProjectsQuerySchema.parse({ includeArchived: 'false' })).toEqual({
      includeArchived: false,
    });
    expect(listProjectsQuerySchema.safeParse({ includeArchived: 'yes' }).success).toBe(false);
  });

  test('accepts only a trimmed name to rename a project', () => {
    expect(renameProjectBodySchema.parse({ name: ' New ' })).toEqual({ name: 'New' });
    expect(renameProjectBodySchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(renameProjectBodySchema.safeParse({ name: 'x', key: 'ABC' }).success).toBe(false);
  });

  test('lets a repository patch change fields or promote it, never demote it', () => {
    expect(patchRepositoryBodySchema.parse({ defaultBranch: 'develop' })).toEqual({
      defaultBranch: 'develop',
    });
    expect(patchRepositoryBodySchema.parse({ isPrimary: true })).toEqual({ isPrimary: true });
    expect(patchRepositoryBodySchema.safeParse({ isPrimary: false }).success).toBe(false);
    expect(patchRepositoryBodySchema.safeParse({ projectId: 'x' }).success).toBe(false);
  });

  test('requires an absolute path to set a checkout location', () => {
    expect(setRepositoryPathBodySchema.parse({ localPath: '/code/app' })).toEqual({
      localPath: '/code/app',
    });
    expect(setRepositoryPathBodySchema.safeParse({ localPath: 'app' }).success).toBe(false);
  });

  test('describes a repository together with its paths', () => {
    const detail = {
      id: newId('repository'),
      projectId: newId('project'),
      name: 'app',
      remoteUrl: 'git@example.com:o/app.git',
      defaultBranch: 'main',
      isPrimary: true,
      paths: [{ runtimeId: newId('runtime'), localPath: '/code/app' }],
    };
    expect(repositoryDetailSchema.parse(detail)).toEqual(detail);
  });
});
