import { describe, expect, it } from 'vitest';
import { createQueryClient, NetworkError } from './query-client.js';

describe('query defaults', () => {
  it('retries network errors only', async () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe('function');
    if (typeof retry !== 'function') throw new Error('Expected retry policy');
    expect(retry(0, new Error('invalid response'))).toBe(false);
    expect(retry(0, new NetworkError('offline'))).toBe(true);
    expect(retry(3, new NetworkError('offline'))).toBe(false);
  });

  it('does not repeat a query that rejects response validation', async () => {
    const client = createQueryClient();
    let calls = 0;
    await expect(
      client.fetchQuery({
        queryKey: ['validation'],
        queryFn: async () => {
          calls++;
          throw new Error('invalid response');
        },
        retryDelay: 0,
      }),
    ).rejects.toThrow('invalid response');
    expect(calls).toBe(1);
  });
});
