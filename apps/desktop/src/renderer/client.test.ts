import { newId } from '@motes/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { ApiRequest } from '../api';
import { createBoardClient } from './board';

describe('desktop board client', () => {
  it('sends board, move and bot requests through the bridge', async () => {
    const projectId = newId('project');
    const cardId = newId('card');
    const call = vi.fn(async (request: ApiRequest) =>
      request.action === 'cards.board'
        ? { columns: [] }
        : request.action === 'bots.list'
          ? []
          : null,
    );
    const client = createBoardClient(call);
    expect(await client.cards.board(projectId, { priority: 'high' }, { columns: [] })).toEqual({
      columns: [],
    });
    expect(await client.cards.move(cardId, { status: 'todo' }, null)).toBeNull();
    expect(await client.bots.list([])).toEqual([]);
    expect(call.mock.calls.map(([request]) => request)).toEqual([
      { action: 'cards.board', projectId, filters: { priority: 'high' } },
      { action: 'cards.move', id: cardId, body: { status: 'todo' } },
      { action: 'bots.list' },
    ]);
  });

  it('turns a malformed answer into an error instead of an invented board', async () => {
    const client = createBoardClient(async () => ({ columns: 'nope' }));
    await expect(client.cards.board(newId('project'), {}, { columns: [] })).rejects.toThrow(
      'Invalid board response',
    );
  });
});
