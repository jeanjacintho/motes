import { describe, expect, it, vi } from 'vitest';
import { createPairingService } from './pairing';

describe('desktop pairing', () => {
  it('stores a successful exchange securely and uses the token for device requests', async () => {
    let value: string | null = null;
    const storage = {
      get: async () => value,
      set: async (v: string) => {
        value = v;
      },
      remove: async () => {
        value = null;
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: 'secret' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    const service = createPairingService(storage, fetch);
    await service.pair('http://localhost:3000', 'Laptop', '12345678');
    expect(await service.isPaired()).toBe(true);
    await service.devices();
    expect(fetch.mock.calls[1]?.[1].headers.authorization).toBe('Bearer secret');
  });

  it('does not store an invalid code and clears a revoked credential', async () => {
    let value: string | null = null;
    const storage = {
      get: async () => value,
      set: async (v: string) => {
        value = v;
      },
      remove: async () => {
        value = null;
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ code: 'validation_failed', message: 'Invalid code', requestId: '1' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: 'secret' }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ code: 'unauthorized', message: 'Unauthorized', requestId: '2' }),
      });
    const service = createPairingService(storage, fetch);
    await expect(service.pair('http://localhost:3000', 'Laptop', 'bad')).rejects.toThrow();
    expect(value).toBeNull();
    await service.pair('http://localhost:3000', 'Laptop', 'valid');
    await expect(service.devices()).rejects.toMatchObject({ status: 401 });
    expect(await service.isPaired()).toBe(false);
  });
});
