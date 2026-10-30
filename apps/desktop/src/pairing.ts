import { ApiError, createApiClient } from '@motes/core';

type Storage = {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
};
type Fetch = Parameters<typeof createApiClient>[0]['fetch'];

export function createPairingService(storage: Storage, fetch: Fetch) {
  let generation = 0;
  let mutations: Promise<void> = Promise.resolve();
  function synchronized<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutations.then(operation);
    mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function credential() {
    const raw = await storage.get();
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('url' in value) ||
      !('token' in value) ||
      typeof value.url !== 'string' ||
      typeof value.token !== 'string'
    )
      throw new Error('Invalid stored credential');
    return { url: value.url, token: value.token };
  }
  function client(url: string, token: string | null, invalid: () => void) {
    return createApiClient({
      baseUrl: url,
      getToken: () => token,
      fetch,
      logger: invalid,
    });
  }
  async function authenticated<T>(operation: (api: ReturnType<typeof client>) => Promise<T>) {
    const snapshot = await synchronized(async () => ({ saved: await credential(), generation }));
    const { saved } = snapshot;
    if (!saved) throw new Error('Not paired');
    let invalid = false;
    try {
      const result = await operation(
        client(saved.url, saved.token, () => {
          invalid = true;
        }),
      );
      if (invalid) throw new Error('Invalid server response');
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const cleared = await synchronized(async () => {
          if (snapshot.generation !== generation) return false;
          await storage.remove();
          generation++;
          return true;
        });
        if (!cleared) throw new Error('Session changed');
      }
      throw error;
    }
  }
  return {
    isPaired: () => synchronized(async () => (await credential()) !== null),
    async pair(url: string, name: string, code: string) {
      const parsed = new URL(url);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      )
        throw new Error('Invalid server URL');
      let invalid = false;
      const result = await client(parsed.href, null, () => {
        invalid = true;
      }).pair({ name, code }, { token: '' });
      if (invalid || !result.token) throw new Error('Invalid server response');
      await synchronized(async () => {
        await storage.set(JSON.stringify({ url: parsed.href, token: result.token }));
        generation++;
      });
    },
    devices: () => authenticated((api) => api.devices.list([])),
    revoke: (id: string) => authenticated((api) => api.devices.revoke(id, { revoked: false })),
  };
}
