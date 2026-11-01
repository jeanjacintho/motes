import { newId } from '@motes/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorageAdapter } from './adapters.js';
import { createApiClient } from './api-client.js';
import { projectKeys, registerProjectInvalidations } from './projects.js';
import { createQueryClient } from './query-client.js';
import { createRealtime, type RealtimeSocket } from './realtime.js';

const project = {
  id: newId('project'),
  key: 'MOT',
  name: 'Motes',
  description: '',
  createdAt: '2026-10-31T10:00:00.000Z',
};
const repository = {
  id: newId('repository'),
  projectId: project.id,
  name: 'app',
  remoteUrl: 'git@example.com:o/app.git',
  defaultBranch: 'main',
  isPrimary: true,
};

function recordingClient(body: unknown) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] =
    [];
  const client = createApiClient({
    baseUrl: 'http://server/',
    getToken: () => 'token',
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return { ok: true, status: 200, json: async () => body };
    },
    logger: vi.fn(),
  });
  return { client, calls };
}

describe('project API client', () => {
  it('lists projects with the archive flag and parses them', async () => {
    const { client, calls } = recordingClient([project]);
    expect(await client.projects.list({ includeArchived: true }, [])).toEqual([project]);
    expect(await client.projects.list({}, [])).toEqual([project]);
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', 'http://server/projects?includeArchived=true'],
      ['GET', 'http://server/projects'],
    ]);
    expect(calls[0]?.headers.authorization).toBe('Bearer token');
  });

  it('sends project mutations with JSON bodies and encoded ids', async () => {
    const { client, calls } = recordingClient(project);
    await client.projects.create({ key: 'MOT', name: 'Motes' }, project);
    await client.projects.rename('prj/1', 'New', project);
    await client.projects.archive('prj/1', project);
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['POST', 'http://server/projects', JSON.stringify({ key: 'MOT', name: 'Motes' })],
      ['PATCH', 'http://server/projects/prj%2F1', JSON.stringify({ name: 'New' })],
      ['POST', 'http://server/projects/prj%2F1/archive', undefined],
    ]);
  });

  it('manages repositories and checkout paths', async () => {
    const detail = { ...repository, paths: [] };
    const { client, calls } = recordingClient([detail]);
    expect(await client.repositories.list(project.id, [])).toEqual([detail]);
    const single = recordingClient(repository);
    await single.client.repositories.add(
      project.id,
      { name: 'app', remoteUrl: repository.remoteUrl, defaultBranch: 'main' },
      repository,
    );
    await single.client.repositories.update(repository.id, { isPrimary: true }, repository);
    await single.client.repositories.setPath(repository.id, 'rt/1', '/code/app', {
      repositoryId: repository.id,
      runtimeId: newId('runtime'),
      localPath: '/code/app',
    });
    const removal = recordingClient({ removed: true });
    await removal.client.repositories.remove(repository.id, { removed: false });
    expect(calls[0]?.url).toBe(`http://server/projects/${project.id}/repositories`);
    expect(single.calls.map((call) => [call.method, call.url])).toEqual([
      ['POST', `http://server/projects/${project.id}/repositories`],
      ['PATCH', `http://server/repositories/${repository.id}`],
      ['PUT', `http://server/repositories/${repository.id}/paths/rt%2F1`],
    ]);
    expect(removal.calls[0]).toMatchObject({
      method: 'DELETE',
      url: `http://server/repositories/${repository.id}`,
    });
  });
});

class FakeSocket implements RealtimeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  send() {}
  close() {}
}

function envelope(type: string, subject: { kind: string; id: string }, payload: object) {
  return {
    id: newId('event'),
    type,
    occurredAt: '2026-10-31T10:00:00.000Z',
    actor: { kind: 'owner' },
    subject,
    payload,
  };
}

describe('project invalidations', () => {
  async function setup() {
    const socket = new FakeSocket();
    const queryClient = createQueryClient();
    const otherProject = newId('project');
    queryClient.setQueryData(projectKeys.all, [project]);
    queryClient.setQueryData(projectKeys.repositories(project.id), []);
    queryClient.setQueryData(projectKeys.repositories(otherProject), []);
    const realtime = createRealtime({
      url: 'ws://test',
      getToken: () => 'token',
      storage: createMemoryStorageAdapter(),
      queryClient,
      logger: vi.fn(),
      socket: () => socket,
    });
    const stop = registerProjectInvalidations(realtime);
    await realtime.start();
    let seq = 0;
    const deliver = async (event: object) => {
      socket.onmessage?.({ data: JSON.stringify({ seq: String(++seq), event }) });
      await vi.waitFor(() => expect(realtime.getEventCount()).toBe(seq));
    };
    const state = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    return { deliver, state, otherProject, stop, realtime };
  }

  it('refreshes the project list on project events', async () => {
    const { deliver, state, realtime } = await setup();
    await deliver(envelope('project.renamed', { kind: 'project', id: project.id }, { name: 'X' }));
    expect(state(projectKeys.all)).toBe(true);
    realtime.stop();
  });

  it('refreshes only the repositories of the affected project', async () => {
    const { deliver, state, otherProject, realtime } = await setup();
    await deliver(
      envelope(
        'repository.path_set',
        { kind: 'repository', id: repository.id },
        { projectId: project.id, runtimeId: newId('runtime') },
      ),
    );
    expect(state(projectKeys.repositories(project.id))).toBe(true);
    expect(state(projectKeys.repositories(otherProject))).toBe(false);
    realtime.stop();
  });

  it('stops refreshing after the returned cleanup runs', async () => {
    const { deliver, state, stop, realtime } = await setup();
    stop();
    await deliver(envelope('project.archived', { kind: 'project', id: project.id }, {}));
    expect(state(projectKeys.all)).toBe(false);
    realtime.stop();
  });
});
