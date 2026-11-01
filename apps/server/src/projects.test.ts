import { withTestDb } from '@motes/db/testing';
import { createPairingCode } from '@motes/domain';
import { apiErrorSchema, newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { createServices } from './composition.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const testDb = withTestDb();

async function setup() {
  const services = createServices(testDb.db);
  const app = createServer(testDb.db, createLogger('silent'), undefined, services);
  const code = await createPairingCode(services);
  const paired = await app.inject({
    method: 'POST',
    url: '/pair',
    payload: { code, name: 'Laptop' },
  });
  const headers = { authorization: `Bearer ${paired.json().token}` };
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
  ) => app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  return { app, call };
}

const repository = (name: string) => ({
  name,
  remoteUrl: `git@example.com:o/${name}.git`,
  defaultBranch: 'main',
});

describe('project routes', () => {
  it('requires authentication', async () => {
    const { app } = await setup();
    for (const [method, url] of [
      ['GET', '/projects'],
      ['POST', '/projects'],
      ['PATCH', `/projects/${newId('project')}`],
      ['POST', `/projects/${newId('project')}/archive`],
      ['GET', `/projects/${newId('project')}/repositories`],
      ['POST', `/projects/${newId('project')}/repositories`],
      ['PATCH', `/repositories/${newId('repository')}`],
      ['DELETE', `/repositories/${newId('repository')}`],
      ['PUT', `/repositories/${newId('repository')}/paths/${newId('runtime')}`],
    ] as const)
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    await app.close();
  });

  it('creates, lists, renames and archives projects with the protocol error codes', async () => {
    const { app, call } = await setup();
    const created = await call('POST', '/projects', { key: 'RTA', name: 'Routes A' });
    expect(created.statusCode).toBe(201);
    const project = created.json();
    expect(project).toMatchObject({ key: 'RTA', name: 'Routes A', description: '' });

    const duplicate = await call('POST', '/projects', { key: 'RTA', name: 'Again' });
    expect(duplicate.statusCode).toBe(409);
    expect(apiErrorSchema.parse(duplicate.json()).code).toBe('conflict');
    const invalid = await call('POST', '/projects', { key: 'x', name: 'Bad' });
    expect(invalid.statusCode).toBe(400);
    expect(apiErrorSchema.parse(invalid.json()).code).toBe('validation_failed');

    const renamed = await call('PATCH', `/projects/${project.id}`, { name: 'Renamed' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe('Renamed');
    expect((await call('PATCH', `/projects/${project.id}`, { name: ' ' })).statusCode).toBe(400);
    const missing = await call('PATCH', `/projects/${newId('project')}`, { name: 'Nope' });
    expect(missing.statusCode).toBe(404);
    expect(apiErrorSchema.parse(missing.json()).code).toBe('not_found');

    const archived = await call('POST', `/projects/${project.id}/archive`);
    expect(archived.statusCode).toBe(200);
    expect(archived.json().archivedAt).toEqual(expect.any(String));
    expect((await call('POST', `/projects/${newId('project')}/archive`)).statusCode).toBe(404);

    const ids = async (query: string) =>
      (await call('GET', `/projects${query}`)).json().map((item: { id: string }) => item.id);
    expect(await ids('')).not.toContain(project.id);
    expect(await ids('?includeArchived=true')).toContain(project.id);
    expect((await call('GET', '/projects?includeArchived=maybe')).statusCode).toBe(400);
    await app.close();
  });

  it('manages repositories, the primary and checkout paths', async () => {
    const { app, call } = await setup();
    const project = (await call('POST', '/projects', { key: 'RTB', name: 'Routes B' })).json();
    const first = await call('POST', `/projects/${project.id}/repositories`, repository('api'));
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ isPrimary: true, projectId: project.id });
    const second = (
      await call('POST', `/projects/${project.id}/repositories`, repository('web'))
    ).json();
    expect(second.isPrimary).toBe(false);
    expect(
      (await call('POST', `/projects/${newId('project')}/repositories`, repository('x')))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call('POST', `/projects/${project.id}/repositories`, {
          ...repository('x'),
          defaultBranch: 'a b',
        })
      ).statusCode,
    ).toBe(400);

    const runtimeId = newId('runtime');
    const path = await call('PUT', `/repositories/${second.id}/paths/${runtimeId}`, {
      localPath: '/code/web',
    });
    expect(path.statusCode).toBe(200);
    expect(path.json()).toEqual({ repositoryId: second.id, runtimeId, localPath: '/code/web' });
    expect(
      (await call('PUT', `/repositories/${second.id}/paths/${runtimeId}`, { localPath: 'web' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('PUT', `/repositories/${second.id}/paths/not-a-runtime`, { localPath: '/x' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call('PUT', `/repositories/${newId('repository')}/paths/${runtimeId}`, {
          localPath: '/x',
        })
      ).statusCode,
    ).toBe(404);

    const listed = await call('GET', `/projects/${project.id}/repositories`);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([
      { ...first.json(), paths: [] },
      { ...second, paths: [{ runtimeId, localPath: '/code/web' }] },
    ]);

    const patched = await call('PATCH', `/repositories/${second.id}`, {
      defaultBranch: 'develop',
      isPrimary: true,
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ defaultBranch: 'develop', isPrimary: true });
    const afterPatch = (await call('GET', `/projects/${project.id}/repositories`)).json();
    expect(afterPatch.map((item: { isPrimary: boolean }) => item.isPrimary)).toEqual([false, true]);
    expect(
      (await call('PATCH', `/repositories/${second.id}`, { isPrimary: false })).statusCode,
    ).toBe(400);
    expect(
      (await call('PATCH', `/repositories/${newId('repository')}`, { name: 'x' })).statusCode,
    ).toBe(404);

    const removed = await call('DELETE', `/repositories/${second.id}`);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ removed: true });
    expect((await call('DELETE', `/repositories/${second.id}`)).statusCode).toBe(404);
    const rest = (await call('GET', `/projects/${project.id}/repositories`)).json();
    expect(rest).toMatchObject([{ id: first.json().id, isPrimary: true }]);
    await app.close();
  });
});
