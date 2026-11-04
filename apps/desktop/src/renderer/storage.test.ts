import { describe, expect, it } from 'vitest';
import { createLocalStorageAdapter } from './storage';

const failing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

function fake() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe('local storage adapter', () => {
  it('reads and writes through the storage, so a new adapter sees the value', async () => {
    const storage = fake();
    await createLocalStorageAdapter(storage).set('k', 'v');
    expect(storage.values.get('k')).toBe('v');
    expect(await createLocalStorageAdapter(storage).get('k')).toBe('v');
    await createLocalStorageAdapter(storage).remove('k');
    expect(await createLocalStorageAdapter(storage).get('k')).toBeNull();
  });

  it('keeps the value for the session when the storage refuses', async () => {
    const adapter = createLocalStorageAdapter(failing);
    expect(await adapter.get('k')).toBeNull();
    await adapter.set('k', 'v');
    expect(await adapter.get('k')).toBe('v');
    await adapter.remove('k');
    expect(await adapter.get('k')).toBeNull();
  });

  it('works without any storage', async () => {
    const adapter = createLocalStorageAdapter(undefined);
    await adapter.set('k', 'v');
    expect(await adapter.get('k')).toBe('v');
  });
});
