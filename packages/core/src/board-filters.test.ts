import { newId } from '@motes/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorageAdapter, type StorageAdapter } from './adapters.js';
import { BOARD_FILTERS_KEY, createBoardFiltersStore } from './board-filters.js';

const projectId = newId('project');
const other = newId('project');
const label = newId('label');

async function ready(store: ReturnType<typeof createBoardFiltersStore>) {
  await vi.waitFor(() => expect(store.getState().hydrated).toBe(true));
}

describe('board filters store', () => {
  it('starts without filters and becomes ready once storage has been read', async () => {
    const store = createBoardFiltersStore(createMemoryStorageAdapter());
    await ready(store);
    expect(store.getState().byProject).toEqual({});
  });

  it('keeps filters per project and drops a project whose filters are all cleared', async () => {
    const store = createBoardFiltersStore(createMemoryStorageAdapter());
    await ready(store);
    store.getState().setFilters(projectId, { priority: 'high', text: 'login' });
    store.getState().setFilters(other, { labelId: label });
    expect(store.getState().byProject).toEqual({
      [projectId]: { priority: 'high', text: 'login' },
      [other]: { labelId: label },
    });
    store.getState().setFilters(projectId, {});
    expect(store.getState().byProject).toEqual({ [other]: { labelId: label } });
  });

  it('survives a restart: a new store over the same storage reads what was chosen', async () => {
    const storage = createMemoryStorageAdapter();
    const first = createBoardFiltersStore(storage);
    await ready(first);
    first
      .getState()
      .setFilters(projectId, { assignee: { type: 'owner', id: 'owner' }, priority: 'low' });
    await vi.waitFor(async () => expect(await storage.get(BOARD_FILTERS_KEY)).not.toBeNull());
    const second = createBoardFiltersStore(storage);
    await ready(second);
    expect(second.getState().byProject).toEqual({
      [projectId]: { assignee: { type: 'owner', id: 'owner' }, priority: 'low' },
    });
  });

  it('stores only filters, never a card, a label or a bot', async () => {
    const storage = createMemoryStorageAdapter();
    const store = createBoardFiltersStore(storage);
    await ready(store);
    store.getState().setFilters(projectId, { labelId: label, text: 'x' });
    await vi.waitFor(async () => expect(await storage.get(BOARD_FILTERS_KEY)).not.toBeNull());
    const saved = JSON.parse((await storage.get(BOARD_FILTERS_KEY)) ?? '{}');
    expect(Object.keys(saved.state)).toEqual(['byProject']);
    expect(saved.state.byProject[projectId]).toEqual({ labelId: label, text: 'x' });
  });

  it('ignores stored choices that no longer parse, keeping the valid ones', async () => {
    const storage = createMemoryStorageAdapter();
    await storage.set(
      BOARD_FILTERS_KEY,
      JSON.stringify({
        state: {
          byProject: {
            [projectId]: { priority: 'high' },
            [other]: { priority: 'not-a-priority' },
            bad: 'nope',
            empty: {},
          },
        },
        version: 1,
      }),
    );
    const store = createBoardFiltersStore(storage);
    await ready(store);
    expect(store.getState().byProject).toEqual({ [projectId]: { priority: 'high' } });
  });

  it.each(['not json', '{"state":null,"version":1}', '{"state":{"byProject":[]},"version":1}'])(
    'starts unfiltered from unreadable storage %s',
    async (stored) => {
      const storage = createMemoryStorageAdapter();
      await storage.set(BOARD_FILTERS_KEY, stored);
      const store = createBoardFiltersStore(storage);
      await ready(store);
      expect(store.getState().byProject).toEqual({});
    },
  );

  it('still works when storage fails to read or write', async () => {
    const broken: StorageAdapter = {
      get: async () => {
        throw new Error('read');
      },
      set: async () => {
        throw new Error('write');
      },
      remove: async () => {},
    };
    const store = createBoardFiltersStore(broken);
    await ready(store);
    store.getState().setFilters(projectId, { text: 'x' });
    expect(store.getState().byProject[projectId]).toEqual({ text: 'x' });
  });
});
