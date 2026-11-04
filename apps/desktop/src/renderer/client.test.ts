import { newId } from '@motes/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { ApiRequest } from '../api';
import { createDesktopClient } from './client';

const at = '2026-10-31T10:00:00.000Z';

describe('desktop client', () => {
  it('sends every call through the bridge as a request', async () => {
    const projectId = newId('project');
    const cardId = newId('card');
    const labelId = newId('label');
    const commentId = newId('comment');
    const call = vi.fn(async (request: ApiRequest) => {
      switch (request.action) {
        case 'cards.board':
          return { columns: [] };
        case 'bots.list':
        case 'labels.list':
        case 'repositories.list':
          return [];
        case 'comments.timeline':
          return { items: [], nextCursor: null };
        case 'comments.remove':
          return { deleted: true };
        default:
          return null;
      }
    });
    const client = createDesktopClient(call);
    await client.cards.board(projectId, { priority: 'high' }, { columns: [] });
    await client.cards.create(projectId, { title: 'Novo' }, null);
    await client.cards.get(cardId, null);
    await client.cards.update(cardId, { title: 'x' }, null);
    await client.cards.assign(cardId, { assignee: null }, null);
    await client.cards.move(cardId, { status: 'todo' }, null);
    await client.cards.attachLabel(cardId, labelId, null);
    await client.cards.detachLabel(cardId, labelId, null);
    await client.bots.list([]);
    await client.labels.list(projectId, []);
    await client.labels.create(projectId, { name: 'bug', color: '#d73a4a' }, null);
    await client.repositories.list(projectId, []);
    await client.comments.timeline(
      cardId,
      { cursor: 'c', limit: 10 },
      { items: [], nextCursor: null },
    );
    await client.comments.timeline(cardId, {}, { items: [], nextCursor: null });
    await client.comments.add(cardId, { body: 'oi' }, null);
    await client.comments.edit(commentId, { body: 'tchau' }, null);
    await client.comments.remove(commentId, { deleted: true });
    expect(call.mock.calls.map(([request]) => request)).toEqual([
      { action: 'cards.board', projectId, filters: { priority: 'high' } },
      { action: 'cards.create', projectId, input: { title: 'Novo' } },
      { action: 'cards.get', id: cardId },
      { action: 'cards.update', id: cardId, patch: { title: 'x' } },
      { action: 'cards.assign', id: cardId, body: { assignee: null } },
      { action: 'cards.move', id: cardId, body: { status: 'todo' } },
      { action: 'cards.attachLabel', id: cardId, labelId },
      { action: 'cards.detachLabel', id: cardId, labelId },
      { action: 'bots.list' },
      { action: 'labels.list', projectId },
      { action: 'labels.create', projectId, input: { name: 'bug', color: '#d73a4a' } },
      { action: 'repositories.list', projectId },
      { action: 'comments.timeline', cardId, cursor: 'c', limit: 10 },
      { action: 'comments.timeline', cardId },
      { action: 'comments.add', cardId, input: { body: 'oi' } },
      { action: 'comments.edit', id: commentId, input: { body: 'tchau' } },
      { action: 'comments.remove', id: commentId },
    ]);
  });

  it('turns a malformed answer into an error instead of an invented board', async () => {
    const client = createDesktopClient(async () => ({ columns: 'nope' }));
    await expect(client.cards.board(newId('project'), {}, { columns: [] })).rejects.toThrow(
      'Invalid board response',
    );
  });

  it('skips timeline lines of a kind it does not know and keeps the rest', async () => {
    const cardId = newId('card');
    const known = {
      kind: 'activity',
      at,
      entry: {
        id: newId('event'),
        cardId,
        type: 'card.created',
        actor: { kind: 'owner' },
        payload: {},
        occurredAt: at,
      },
    };
    const client = createDesktopClient(async () => ({
      items: [known, { kind: 'run', at }],
      nextCursor: 'next',
    }));
    expect(await client.comments.timeline(cardId, {}, { items: [], nextCursor: null })).toEqual({
      items: [known],
      nextCursor: 'next',
    });
  });
});
