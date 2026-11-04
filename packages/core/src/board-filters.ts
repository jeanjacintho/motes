import { type BoardFilters, boardFiltersSchema } from '@motes/protocol';
import { createStore, type StoreApi, useStore } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StorageAdapter } from './adapters.js';

export const BOARD_FILTERS_KEY = 'motes.board-filters';

export type BoardFiltersState = {
  /** What the owner last chose for each project; nothing from the server, only ids and text. */
  byProject: Record<string, BoardFilters>;
  /** False until the stored choices have been read, so a screen can wait instead of flashing. */
  hydrated: boolean;
  setFilters(projectId: string, filters: BoardFilters): void;
};

export type BoardFiltersStore = StoreApi<BoardFiltersState>;

const noFilters: BoardFilters = Object.freeze({});

/** Keeps only what still parses: a choice saved by another version never breaks the board. */
function readStored(value: unknown): Record<string, BoardFilters> {
  const stored = (value as { byProject?: unknown } | null)?.byProject;
  if (typeof stored !== 'object' || stored === null) return {};
  const byProject: Record<string, BoardFilters> = {};
  for (const [projectId, filters] of Object.entries(stored)) {
    const parsed = boardFiltersSchema.safeParse(filters);
    if (parsed.success && Object.keys(parsed.data).length > 0) byProject[projectId] = parsed.data;
  }
  return byProject;
}

/**
 * The board filters, kept as a durable preference through the platform's storage adapter. This is
 * client state: the filters name labels and bots by id but never hold a card, label or bot.
 */
export function createBoardFiltersStore(storage: StorageAdapter): BoardFiltersStore {
  const store: BoardFiltersStore = createStore<BoardFiltersState>()(
    persist(
      (set) => ({
        byProject: {},
        hydrated: false,
        setFilters: (projectId, filters) =>
          set((state) => {
            const { [projectId]: _previous, ...rest } = state.byProject;
            // A project with no filter left has no entry at all.
            return Object.keys(filters).length === 0
              ? { byProject: rest }
              : { byProject: { ...rest, [projectId]: filters } };
          }),
      }),
      {
        name: BOARD_FILTERS_KEY,
        version: 1,
        // zustand's storage speaks getItem/setItem/removeItem; the adapter speaks get/set/remove.
        storage: createJSONStorage(() => ({
          getItem: (key) => storage.get(key),
          // A filter that cannot be saved still works for this session.
          setItem: (key, value) => storage.set(key, value).catch(() => {}),
          removeItem: (key) => storage.remove(key),
        })),
        partialize: (state) => ({ byProject: state.byProject }),
        merge: (persisted, current) => ({ ...current, byProject: readStored(persisted) }),
        // Also reached when storage is unreadable; the board then starts unfiltered.
        onRehydrateStorage: () => () => store.setState({ hydrated: true }),
      },
    ),
  );
  return store;
}

/** The filters of one project, and whether the stored choices have been read yet. */
export function useBoardFilters(store: BoardFiltersStore, projectId: string) {
  const filters = useStore(store, (state) => state.byProject[projectId] ?? noFilters);
  const ready = useStore(store, (state) => state.hydrated);
  const setFilters = useStore(store, (state) => state.setFilters);
  return {
    filters,
    ready,
    setFilters: (next: BoardFilters) => setFilters(projectId, next),
    clear: () => setFilters(projectId, {}),
  };
}
