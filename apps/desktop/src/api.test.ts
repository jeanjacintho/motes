import { ApiError } from '@motes/core';
import { newId } from '@motes/protocol';
import { describe, expect, it, vi } from 'vitest';
import { type ApiService, createApiHandler } from './api';

const mainFrame = { url: 'http://localhost:5173/' };
const sender = { mainFrame };
const event = { sender, senderFrame: mainFrame };

function setup() {
  const calls: [string, unknown[]][] = [];
  const record =
    (name: string, value: unknown = { ok: true }) =>
    (...args: unknown[]) => {
      calls.push([name, args.slice(0, -1)]);
      return Promise.resolve(value);
    };
  const client = {
    projects: {
      list: record('projects.list', []),
      create: record('projects.create'),
      rename: record('projects.rename'),
      archive: record('projects.archive'),
    },
    repositories: {
      list: record('repositories.list', []),
      add: record('repositories.add'),
      update: record('repositories.update'),
      remove: record('repositories.remove'),
      setPath: record('repositories.setPath'),
    },
    cards: {
      board: record('cards.board', { columns: [] }),
      move: record('cards.move'),
    },
    bots: { list: record('bots.list', []) },
  };
  const service: ApiService = { api: (operation) => operation(client as never) };
  return { calls, handler: createApiHandler(sender, mainFrame.url, service), service };
}

describe('desktop API bridge', () => {
  it('maps every action to the matching client call', async () => {
    const { calls, handler } = setup();
    const projectId = newId('project');
    const repositoryId = newId('repository');
    const runtimeId = newId('runtime');
    const cardId = newId('card');
    const otherCardId = newId('card');
    const requests = [
      { action: 'projects.list', includeArchived: true },
      { action: 'projects.create', input: { key: 'MOT', name: 'Motes' } },
      { action: 'projects.rename', id: projectId, name: 'New' },
      { action: 'projects.archive', id: projectId },
      { action: 'repositories.list', projectId },
      {
        action: 'repositories.add',
        projectId,
        input: { name: 'api', remoteUrl: 'git@x:o/a.git', defaultBranch: 'main' },
      },
      { action: 'repositories.update', id: repositoryId, patch: { isPrimary: true } },
      { action: 'repositories.remove', id: repositoryId },
      { action: 'repositories.setPath', id: repositoryId, runtimeId, localPath: '/code' },
      { action: 'cards.board', projectId, filters: { priority: 'high' } },
      { action: 'cards.board', projectId },
      { action: 'cards.move', id: cardId, body: { status: 'todo', afterId: otherCardId } },
      { action: 'bots.list' },
    ];
    for (const request of requests)
      expect(await handler(event, request), request.action).toMatchObject({ ok: true });
    expect(calls.map(([name]) => name)).toEqual(requests.map((request) => request.action));
    expect(calls[0]?.[1]).toEqual([{ includeArchived: true }]);
    expect(calls[8]?.[1]).toEqual([repositoryId, runtimeId, '/code']);
    expect(calls[9]?.[1]).toEqual([projectId, { priority: 'high' }]);
    expect(calls[10]?.[1]).toEqual([projectId, {}]);
    expect(calls[11]?.[1]).toEqual([cardId, { status: 'todo', afterId: otherCardId }]);
    expect(calls[12]?.[1]).toEqual([]);
  });

  it('rejects an untrusted sender, extra arguments and malformed requests', async () => {
    const { handler } = setup();
    await expect(
      handler({ sender, senderFrame: { url: mainFrame.url } }, { action: 'projects.list' }),
    ).rejects.toThrow('Untrusted IPC sender');
    await expect(handler(event, { action: 'projects.list' }, 'extra')).rejects.toThrow(
      'Invalid IPC request',
    );
    await expect(handler(event, { action: 'projects.delete' })).rejects.toThrow(
      'Invalid IPC request',
    );
    await expect(
      handler(event, { action: 'projects.create', input: { key: 'x', name: '' } }),
    ).rejects.toThrow('Invalid IPC request');
    await expect(
      handler(event, { action: 'projects.list', includeArchived: true, extra: 1 }),
    ).rejects.toThrow('Invalid IPC request');
  });

  it('reports failures without leaking details, keeping the error code', async () => {
    const envelope = { code: 'conflict', message: 'taken', requestId: 'r1' } as const;
    const conflict = vi.fn().mockRejectedValue(new ApiError(envelope, 409));
    const { service } = setup();
    const handler = createApiHandler(sender, mainFrame.url, {
      api: (operation) => operation({ projects: { create: conflict }, repositories: {} } as never),
    });
    expect(
      await handler(event, { action: 'projects.create', input: { key: 'MOT', name: 'Motes' } }),
    ).toEqual({ ok: false, unauthorized: false, code: 'conflict' });
    const unauthorized = createApiHandler(sender, mainFrame.url, {
      api: () => Promise.reject(new ApiError({ ...envelope, code: 'unauthorized' }, 401)),
    });
    expect(await unauthorized(event, { action: 'projects.list' })).toEqual({
      ok: false,
      unauthorized: true,
      code: 'unauthorized',
    });
    const broken = createApiHandler(sender, mainFrame.url, {
      api: () => Promise.reject(new Error('boom with secret')),
    });
    expect(await broken(event, { action: 'projects.list' })).toEqual({
      ok: false,
      unauthorized: false,
    });
    expect(service).toBeDefined();
  });
});
