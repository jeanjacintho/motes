import { createMemoryStorageAdapter, type StorageAdapter } from '@motes/core';

/**
 * Durable preferences in the renderer's own storage, which Electron keeps in the app's data
 * folder between runs. Nothing secret goes through it: tokens have their own store in the main
 * process. If the storage is unavailable the preferences last for the session only.
 */
export function createLocalStorageAdapter(
  storage:
    | Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
    | undefined = globalThis.localStorage,
): StorageAdapter {
  const memory = createMemoryStorageAdapter();
  return {
    async get(key) {
      try {
        return storage?.getItem(key) ?? (await memory.get(key));
      } catch {
        return memory.get(key);
      }
    },
    async set(key, value) {
      await memory.set(key, value);
      try {
        storage?.setItem(key, value);
      } catch {
        // The session copy above still holds the value.
      }
    },
    async remove(key) {
      await memory.remove(key);
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing to undo.
      }
    },
  };
}
