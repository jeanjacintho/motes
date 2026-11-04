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
      get: record('cards.get'),
      update: record('cards.update'),
      assign: record('cards.assign'),
      attachLabel: record('cards.attachLabel'),
      detachLabel: record('cards.detachLabel'),
    },
    bots: { list: record('bots.list', []) },
    labels: { list: record('labels.list', []), create: record('labels.create') },
    comments: {
      timeline: record('comments.timeline', { items: [], nextCursor: null }),
      add: record('comments.add'),
      edit: record('comments.edit'),
      remove: record('comments.remove', { deleted: true }),
    },
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
    const labelId = newId('label');
    const commentId = newId('comment');
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
      { action: 'cards.get', id: cardId },
      { action: 'cards.update', id: cardId, patch: { title: 'Novo' } },
      { action: 'cards.assign', id: cardId, body: { assignee: null } },
      { action: 'cards.attachLabel', id: cardId, labelId },
      { action: 'cards.detachLabel', id: cardId, labelId },
      { action: 'labels.list', projectId },
      { action: 'labels.create', projectId, input: { name: 'bug', color: '#d73a4a' } },
      { action: 'comments.timeline', cardId, cursor: 'abc', limit: 20 },
      { action: 'comments.timeline', cardId },
      { action: 'comments.add', cardId, input: { body: 'oi' } },
      { action: 'comments.edit', id: commentId, input: { body: 'tchau' } },
      { action: 'comments.remove', id: commentId },
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
    expect(calls[13]?.[1]).toEqual([cardId]);
    expect(calls[14]?.[1]).toEqual([cardId, { title: 'Novo' }]);
    expect(calls[15]?.[1]).toEqual([cardId, { assignee: null }]);
    expect(calls[16]?.[1]).toEqual([cardId, labelId]);
    expect(calls[17]?.[1]).toEqual([cardId, labelId]);
    expect(calls[18]?.[1]).toEqual([projectId]);
    expect(calls[19]?.[1]).toEqual([projectId, { name: 'bug', color: '#d73a4a' }]);
    expect(calls[20]?.[1]).toEqual([cardId, { cursor: 'abc', limit: 20 }]);
    expect(calls[21]?.[1]).toEqual([cardId, { cursor: undefined, limit: undefined }]);
    expect(calls[22]?.[1]).toEqual([cardId, { body: 'oi' }]);
    expect(calls[23]?.[1]).toEqual([commentId, { body: 'tchau' }]);
    expect(calls[24]?.[1]).toEqual([commentId]);
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
