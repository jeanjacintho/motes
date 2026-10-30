import { describe, expect, it } from 'vitest';
import {
  createMemoryPlatformAdapter,
  createMemorySecureStorageAdapter,
  createMemoryStorageAdapter,
} from './index.js';

describe('in-memory adapters', () => {
  it('stores, overwrites and removes values independently', async () => {
    const storage = createMemoryStorageAdapter();
    expect(await storage.get('missing')).toBeNull();
    await storage.set('key', 'first');
    await storage.set('other', 'value');
    await storage.set('key', 'second');
    expect(await storage.get('key')).toBe('second');
    await storage.remove('key');
    expect(await storage.get('key')).toBeNull();
    expect(await storage.get('other')).toBe('value');
  });

  it('stores and removes a token independently of ordinary storage', async () => {
    const secure = createMemorySecureStorageAdapter();
    expect(await secure.getToken()).toBeNull();
    await secure.setToken('token');
    expect(await secure.getToken()).toBe('token');
    await secure.removeToken();
    expect(await secure.getToken()).toBeNull();
  });

  it('records notifications and external links', async () => {
    const platform = createMemoryPlatformAdapter();
    await platform.notify({ title: 'Title', body: 'Body' });
    await platform.openExternal('https://example.com');
    expect(platform.notifications).toEqual([{ title: 'Title', body: 'Body' }]);
    expect(platform.openedLinks).toEqual(['https://example.com']);
  });
});
