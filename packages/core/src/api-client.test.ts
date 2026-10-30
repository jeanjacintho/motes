import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './index.js';

describe('API client', () => {
  it('returns the supplied fallback and logs malformed responses', async () => {
    const logger = vi.fn();
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => null,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ version: 42 }) }),
      logger,
    });
    const fallback = { version: 'unknown', uptime: 0, database: false, migrations: false };
    expect(await client.health(fallback)).toEqual(fallback);
    expect(logger).toHaveBeenCalledOnce();
  });

  it('exposes the unauthorized envelope as an ApiError', async () => {
    const envelope = {
      code: 'unauthorized',
      message: 'Authentication required',
      requestId: 'req-1',
    };
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => 'token',
      fetch: async () => ({ ok: false, status: 401, json: async () => envelope }),
      logger: vi.fn(),
    });
    const error = await client.devices.list([]).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'unauthorized', envelope, status: 401 });
  });

  it('preserves error context for a future error code', async () => {
    const envelope = {
      code: 'future_error',
      message: 'Specific reason',
      requestId: 'req-future',
      details: { retry: false },
    };
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => null,
      fetch: async () => ({ ok: false, status: 422, json: async () => envelope }),
      logger: vi.fn(),
    });
    const error = await client.devices.list([]).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'unknown',
      status: 422,
      envelope: { ...envelope, code: 'unknown' },
    });
  });

  it('accepts a newer device kind without losing the device', async () => {
    const device = {
      id: 'dev_1',
      name: 'Laptop',
      kind: 'future',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
    };
    const client = createApiClient({
      baseUrl: 'http://server',
      getToken: () => null,
      fetch: async () => ({ ok: true, status: 200, json: async () => [device] }),
      logger: vi.fn(),
    });
    expect(await client.devices.list([])).toEqual([{ ...device, kind: 'unknown' }]);
  });

  it('sends the correct requests and parses endpoint responses', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: 'paired' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'dev_1',
            name: 'Laptop',
            kind: 'client',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: null,
            revokedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revoked: true }) });
    const client = createApiClient({
      baseUrl: 'http://server/',
      getToken: async () => 'token',
      fetch,
      logger: vi.fn(),
    });
    expect(await client.pair({ code: 'CODE', name: 'Laptop' }, { token: '' })).toEqual({
      token: 'paired',
    });
    expect((await client.devices.list([]))[0]?.name).toBe('Laptop');
    expect(await client.devices.revoke('dev /1', { revoked: false })).toEqual({ revoked: true });
    expect(fetch).toHaveBeenNthCalledWith(1, 'http://server/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'CODE', name: 'Laptop' }),
    });
    expect(fetch).toHaveBeenNthCalledWith(2, 'http://server/devices', {
      method: 'GET',
      headers: { authorization: 'Bearer token' },
    });
    expect(fetch).toHaveBeenNthCalledWith(3, 'http://server/devices/dev%20%2F1', {
      method: 'DELETE',
      headers: { authorization: 'Bearer token' },
    });
  });
});
