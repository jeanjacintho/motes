import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { projects, repositories, repositoryPaths } from './schema.js';
import { withTestDb } from './testing.js';

const testDb = withTestDb();

async function project(key: string) {
  const id = newId('project');
  await testDb.db
    .insert(projects)
    .values({ id, key, name: key, description: '', createdAt: new Date() });
  return id;
}

function repository(projectId: string, isPrimary: boolean, name = 'repo') {
  return {
    id: newId('repository'),
    projectId,
    name,
    remoteUrl: 'git@example.com:a/b.git',
    defaultBranch: 'main',
    isPrimary,
    createdAt: new Date(),
  };
}

describe('repository tables', () => {
  it('allows one primary per project but any number of secondary repositories', async () => {
    const one = await project('REPA');
    const two = await project('REPB');
    await testDb.db.insert(repositories).values(repository(one, true));
    await testDb.db.insert(repositories).values(repository(one, false));
    await testDb.db.insert(repositories).values(repository(one, false));
    await testDb.db.insert(repositories).values(repository(two, true));
    await expect(testDb.db.insert(repositories).values(repository(one, true))).rejects.toThrow();
  });

  it('requires an existing project and a nonblank name', async () => {
    await expect(
      testDb.db.insert(repositories).values(repository(newId('project'), false)),
    ).rejects.toThrow();
    const id = await project('REPC');
    await expect(
      testDb.db.insert(repositories).values(repository(id, false, '  ')),
    ).rejects.toThrow();
  });

  it('keeps one absolute path per repository and runtime', async () => {
    const id = await project('REPD');
    const repo = repository(id, true);
    await testDb.db.insert(repositories).values(repo);
    const path = { repositoryId: repo.id, runtimeId: newId('runtime'), localPath: '/code/repo' };
    await testDb.db.insert(repositoryPaths).values(path);
    await expect(testDb.db.insert(repositoryPaths).values(path)).rejects.toThrow();
    await expect(
      testDb.db
        .insert(repositoryPaths)
        .values({ ...path, runtimeId: newId('runtime'), localPath: 'relative' }),
    ).rejects.toThrow();
    await expect(
      testDb.db.insert(repositoryPaths).values({ ...path, repositoryId: newId('repository') }),
    ).rejects.toThrow();
  });
});
