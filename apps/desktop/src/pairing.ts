import { ApiError, createApiClient } from '@motes/core';

type Storage = {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
};
type Fetch = Parameters<typeof createApiClient>[0]['fetch'];

export function createPairingService(storage: Storage, fetch: Fetch) {
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
    const saved = await credential();
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
      if (error instanceof ApiError && error.status === 401) await storage.remove();
      throw error;
    }
  }
  return {
    isPaired: async () => (await credential()) !== null,
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
      await storage.set(JSON.stringify({ url: parsed.href, token: result.token }));
    },
    devices: () => authenticated((api) => api.devices.list([])),
    revoke: (id: string) => authenticated((api) => api.devices.revoke(id, { revoked: false })),
  };
}
