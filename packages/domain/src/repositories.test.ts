import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { Conflict, NotFound, ValidationFailed } from './errors.js';
import { createProject } from './projects.js';
import {
  addRepository,
  listRepositories,
  listRepositoryPaths,
  removeRepository,
  setPrimaryRepository,
  setRepositoryPath,
  updateRepository,
} from './repositories.js';

const testDb = withTestDb();

function services(overrides: Record<string, unknown> = {}) {
  return {
    db: testDb.db,
    appendEvent,
    clock: () => new Date('2026-10-31T10:00:00.000Z'),
    newId,
    ...overrides,
  };
}

let counter = 0;
async function newProject() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const key = `R${letters[counter % 26]}${letters[Math.floor(counter / 26) % 26]}`;
  counter++;
  return createProject(services(), { key, name: `Project ${key}` });
}

const input = (name: string) => ({
  name,
  remoteUrl: `git@example.com:owner/${name}.git`,
  defaultBranch: 'main',
});

async function eventTypes(subjectId: string) {
  const rows = await testDb.db.$client`
    SELECT type FROM events WHERE subject_id = ${subjectId} ORDER BY seq`;
  return rows.map((row) => row.type);
}

describe('repositories', () => {
  it('makes the first repository primary and emits repository.added', async () => {
    const project = await newProject();
    const first = await addRepository(services(), project.id, input('api'));
    const second = await addRepository(services(), project.id, input('web'));
    expect(first).toMatchObject({ projectId: project.id, name: 'api', isPrimary: true });
    expect(second.isPrimary).toBe(false);
    const rows = await testDb.db.$client`
      SELECT payload FROM events WHERE subject_id = ${first.id}`;
    expect(rows[0]?.payload).toEqual({ projectId: project.id, name: 'api' });
    expect((await listRepositories(services(), project.id)).map((repo) => repo.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('rejects unknown projects and malformed input', async () => {
    await expect(addRepository(services(), newId('project'), input('x'))).rejects.toBeInstanceOf(
      NotFound,
    );
    const project = await newProject();
    await expect(
      addRepository(services(), project.id, { ...input('x'), defaultBranch: 'a b' }),
    ).rejects.toBeInstanceOf(ValidationFailed);
  });

  it('moves the primary atomically and never leaves two primaries', async () => {
    const project = await newProject();
    const first = await addRepository(services(), project.id, input('api'));
    const second = await addRepository(services(), project.id, input('web'));
    const third = await addRepository(services(), project.id, input('cli'));
    await setPrimaryRepository(services(), second.id);
    const primaries = (await listRepositories(services(), project.id)).filter(
      (repo) => repo.isPrimary,
    );
    expect(primaries.map((repo) => repo.id)).toEqual([second.id]);
    expect(await eventTypes(first.id)).toEqual(['repository.added', 'repository.updated']);
    await Promise.all([
      setPrimaryRepository(services(), first.id),
      setPrimaryRepository(services(), third.id),
    ]);
    expect(
      (await listRepositories(services(), project.id)).filter((repo) => repo.isPrimary),
    ).toHaveLength(1);
    const current = (await listRepositories(services(), project.id)).find((repo) => repo.isPrimary);
    if (!current) throw new Error('Missing primary');
    const before = await eventTypes(current.id);
    await setPrimaryRepository(services(), current.id);
    expect(await eventTypes(current.id)).toEqual(before);
  });

  it('changes fields and promotes in one update with a single event for the target', async () => {
    const project = await newProject();
    const first = await addRepository(services(), project.id, input('api'));
    const second = await addRepository(services(), project.id, input('web'));
    const result = await updateRepository(services(), second.id, {
      defaultBranch: 'develop',
      isPrimary: true,
    });
    expect(result).toMatchObject({ defaultBranch: 'develop', isPrimary: true });
    expect(await eventTypes(second.id)).toEqual(['repository.added', 'repository.updated']);
    expect(await eventTypes(first.id)).toEqual(['repository.added', 'repository.updated']);
    await expect(
      updateRepository(services(), second.id, { isPrimary: false } as never),
    ).rejects.toBeInstanceOf(ValidationFailed);
  });

  it('removes a repository with its paths and promotes the oldest remaining one', async () => {
    const project = await newProject();
    const first = await addRepository(services(), project.id, input('api'));
    const second = await addRepository(
      services({ clock: () => new Date('2026-10-31T11:00:00.000Z') }),
      project.id,
      input('web'),
    );
    await addRepository(
      services({ clock: () => new Date('2026-10-31T12:00:00.000Z') }),
      project.id,
      input('cli'),
    );
    await setRepositoryPath(services(), first.id, newId('runtime'), '/code/api');
    await removeRepository(services(), first.id);
    expect(await listRepositoryPaths(services(), first.id)).toEqual([]);
    const remaining = await listRepositories(services(), project.id);
    expect(remaining.map((repo) => repo.name)).toEqual(['web', 'cli']);
    expect(remaining.find((repo) => repo.isPrimary)?.id).toBe(second.id);
    expect(await eventTypes(first.id)).toContain('repository.removed');
    await expect(removeRepository(services(), first.id)).rejects.toBeInstanceOf(NotFound);
  });

  it.each([
    [
      'an update',
      (id: string, gated: ReturnType<typeof services>) =>
        updateRepository(gated, id, { name: 'renamed' }),
    ],
    [
      'a path change',
      (id: string, gated: ReturnType<typeof services>) =>
        setRepositoryPath(gated, id, newId('runtime'), '/code/web'),
    ],
  ])(
    'removes the primary while %s runs on the repository to be promoted',
    async (_name, change) => {
      const project = await newProject();
      const primary = await addRepository(services(), project.id, input('api'));
      const secondary = await addRepository(
        services({ clock: () => new Date('2026-10-31T11:00:00.000Z') }),
        project.id,
        input('web'),
      );
      // Hold the secondary's row lock until the removal has had time to run into it.
      let reached: () => void = () => {};
      const atGate = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const gated = services({
        appendEvent: async (...args: Parameters<typeof appendEvent>) => {
          reached();
          await gate;
          return appendEvent(...args);
        },
      });
      const changing = change(secondary.id, gated);
      await atGate;
      const removing = removeRepository(services(), primary.id);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      release();
      await Promise.all([changing, removing]);
      const remaining = await listRepositories(services(), project.id);
      expect(remaining.map((repo) => repo.id)).toEqual([secondary.id]);
      expect(remaining[0]?.isPrimary).toBe(true);
    },
    20000,
  );

  it('refuses to remove a repository that open cards use', async () => {
    const project = await newProject();
    const repo = await addRepository(services(), project.id, input('api'));
    const inUse = services({ repositoryInUse: async () => true });
    await expect(removeRepository(inUse, repo.id)).rejects.toBeInstanceOf(Conflict);
    expect(await listRepositories(services(), project.id)).toHaveLength(1);
    expect(await eventTypes(repo.id)).toEqual(['repository.added']);
  });

  it('updates fields, skips no-op updates and reports unknown ids', async () => {
    const project = await newProject();
    const repo = await addRepository(services(), project.id, input('api'));
    const updated = await updateRepository(services(), repo.id, { defaultBranch: 'develop' });
    expect(updated).toMatchObject({ defaultBranch: 'develop', name: 'api' });
    await updateRepository(services(), repo.id, { defaultBranch: 'develop' });
    expect(await eventTypes(repo.id)).toEqual(['repository.added', 'repository.updated']);
    await expect(updateRepository(services(), repo.id, { name: ' ' })).rejects.toBeInstanceOf(
      ValidationFailed,
    );
    await expect(
      updateRepository(services(), newId('repository'), { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('sets a local path per runtime idempotently', async () => {
    const project = await newProject();
    const repo = await addRepository(services(), project.id, input('api'));
    const runtimeId = newId('runtime');
    await setRepositoryPath(services(), repo.id, runtimeId, '/code/api');
    await setRepositoryPath(services(), repo.id, runtimeId, '/code/api');
    await setRepositoryPath(services(), repo.id, runtimeId, '/work/api');
    expect(await listRepositoryPaths(services(), repo.id)).toEqual([
      { repositoryId: repo.id, runtimeId, localPath: '/work/api' },
    ]);
    expect(await eventTypes(repo.id)).toEqual([
      'repository.added',
      'repository.path_set',
      'repository.path_set',
    ]);
    await expect(
      setRepositoryPath(services(), repo.id, runtimeId, 'relative'),
    ).rejects.toBeInstanceOf(ValidationFailed);
    await expect(
      setRepositoryPath(services(), newId('repository'), runtimeId, '/x'),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('rolls the change back when its event cannot be stored', async () => {
    const project = await newProject();
    const failing = services({
      appendEvent: async () => {
        throw new Error('outbox unavailable');
      },
    });
    await expect(addRepository(failing, project.id, input('api'))).rejects.toThrow(
      'outbox unavailable',
    );
    expect(await listRepositories(services(), project.id)).toEqual([]);
  });
});
