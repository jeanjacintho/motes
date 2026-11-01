import { describe, expect, test, vi } from 'vitest';
import {
  addRepositoryInputSchema,
  newId,
  parseClientEvent,
  parseEvent,
  repositoryPathSchema,
  repositorySchema,
  updateRepositoryInputSchema,
} from './index.js';

const repository = {
  id: newId('repository'),
  projectId: newId('project'),
  name: 'motes',
  remoteUrl: 'git@github.com:jeanjacintho/motes.git',
  defaultBranch: 'main',
  isPrimary: true,
};

describe('repository contracts', () => {
  test('accepts a repository and its local path per runtime', () => {
    expect(repositorySchema.parse(repository)).toEqual(repository);
    const path = {
      repositoryId: repository.id,
      runtimeId: newId('runtime'),
      localPath: '/Users/owner/code/motes',
    };
    expect(repositoryPathSchema.parse(path)).toEqual(path);
  });

  test('requires an absolute local path without NUL characters', () => {
    const base = { repositoryId: repository.id, runtimeId: newId('runtime') };
    expect(repositoryPathSchema.safeParse({ ...base, localPath: 'relative/path' }).success).toBe(
      false,
    );
    expect(repositoryPathSchema.safeParse({ ...base, localPath: '/a\0b' }).success).toBe(false);
  });

  test('trims the name and rejects blank values or a branch with whitespace', () => {
    const input = {
      name: ' motes ',
      remoteUrl: 'https://example.com/a.git',
      defaultBranch: 'main',
    };
    expect(addRepositoryInputSchema.parse(input).name).toBe('motes');
    expect(addRepositoryInputSchema.safeParse({ ...input, name: ' ' }).success).toBe(false);
    expect(addRepositoryInputSchema.safeParse({ ...input, remoteUrl: '' }).success).toBe(false);
    expect(
      addRepositoryInputSchema.safeParse({ ...input, defaultBranch: 'my branch' }).success,
    ).toBe(false);
    expect(updateRepositoryInputSchema.parse({})).toEqual({});
    expect(updateRepositoryInputSchema.safeParse({ defaultBranch: '' }).success).toBe(false);
  });

  test.each([
    ['repository.added', { projectId: repository.projectId, name: 'motes' }],
    ['repository.updated', { projectId: repository.projectId }],
    ['repository.removed', { projectId: repository.projectId }],
    ['repository.path_set', { projectId: repository.projectId, runtimeId: newId('runtime') }],
  ])('registers %s', (type, payload) => {
    const raw = {
      id: newId('event'),
      type,
      occurredAt: '2026-10-31T10:00:00.000Z',
      actor: { kind: 'owner' },
      subject: { kind: 'repository', id: repository.id },
      payload,
    };
    expect(parseEvent(raw)).toEqual(raw);
    expect(parseClientEvent(raw, vi.fn())?.type).toBe(type);
    expect(() => parseEvent({ ...raw, payload: { ...payload, extra: 1 } })).toThrow();
  });
});
