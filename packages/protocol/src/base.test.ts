import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  API_ERROR_CODES,
  apiErrorSchema,
  pageRequestSchema,
  pageSchema,
  timestampSchema,
  type Usage,
  usageSchema,
} from './index.js';

describe('timestamps', () => {
  test.each(['2026-10-30T07:12:58Z', '2024-02-29T00:00:00.123456Z'])(
    'accepts UTC ISO timestamps without changing them: %s',
    (value) => expect(timestampSchema.parse(value)).toBe(value),
  );

  test.each([
    'not-a-timestamp',
    '2026-02-29T00:00:00Z',
    '2026-10-30T24:00:00Z',
    '2026-10-30T00:60:00Z',
    '2026-10-30',
    '2026-10-30T07:12:58',
    '2026-10-30T07:12:58+03:00',
    '2026-10-30T07:12:58+00:00',
    '',
    null,
    123,
  ])('rejects malformed or noncanonical UTC timestamps: %j', (value) => {
    expect(timestampSchema.safeParse(value).success).toBe(false);
  });
});

describe('pagination', () => {
  test.each([1, 200])('accepts the inclusive limit boundary %i', (limit) => {
    expect(pageRequestSchema.parse({ limit })).toEqual({ limit });
    expect(pageRequestSchema.parse({ cursor: 'opaque-cursor', limit })).toEqual({
      cursor: 'opaque-cursor',
      limit,
    });
  });

  test.each([0, 201, -1, 1.5, '10', null, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid limits: %j',
    (limit) => expect(pageRequestSchema.safeParse({ limit }).success).toBe(false),
  );

  test.each([{}, { limit: 10, cursor: '' }, { limit: 10, cursor: null }])(
    'rejects a missing limit or invalid cursor: %j',
    (value) => expect(pageRequestSchema.safeParse(value).success).toBe(false),
  );

  const item = z.object({ name: z.string() });
  const page = pageSchema(item);

  test('validates typed items and an opaque continuation cursor', () => {
    const value = { items: [{ name: 'First' }], nextCursor: 'opaque-cursor' };
    const parsed = page.parse(value);
    expect(parsed).toEqual(value);
    expectTypeOf(parsed.items).toEqualTypeOf<{ name: string }[]>();
  });

  test('represents an exhausted page with a null cursor, including empty pages', () => {
    for (const items of [[], [{ name: 'Last' }]]) {
      expect(page.parse({ items, nextCursor: null })).toEqual({ items, nextCursor: null });
    }
  });

  test.each([
    { items: [{ name: 1 }], nextCursor: null },
    { items: 'invalid', nextCursor: null },
    { items: [], nextCursor: '' },
    { items: [], nextCursor: 1 },
    { items: [] },
    { nextCursor: null },
  ])('rejects malformed page responses: %j', (value) => {
    expect(page.safeParse(value).success).toBe(false);
  });
});

describe('API errors', () => {
  const error = { code: 'validation_failed', message: 'Invalid limit', requestId: 'req-123' };

  test('defines the stable error codes and accepts every code', () => {
    expect(API_ERROR_CODES).toEqual([
      'unauthorized',
      'not_found',
      'validation_failed',
      'conflict',
      'rate_limited',
      'internal',
    ]);
    for (const code of API_ERROR_CODES) {
      expect(apiErrorSchema.parse({ ...error, code })).toEqual({ ...error, code });
    }
  });

  test('accepts omitted details and preserves structured JSON details', () => {
    expect(apiErrorSchema.parse(error)).toEqual(error);
    const withDetails = { ...error, details: { fields: [{ path: ['limit'], minimum: 1 }] } };
    expect(apiErrorSchema.parse(withDetails)).toEqual(withDetails);
  });

  test.each(['code', 'message', 'requestId'] as const)('requires %s', (field) => {
    const value: Record<string, unknown> = { ...error };
    delete value[field];
    expect(apiErrorSchema.safeParse(value).success).toBe(false);
  });

  test.each([
    { code: 'unrecognized' },
    { code: 500 },
    { message: '' },
    { message: null },
    { requestId: '' },
    { requestId: 123 },
    { details: { invalid: Number.POSITIVE_INFINITY } },
    { details: () => 'not JSON' },
  ])('rejects invalid error fields: %j', (fields) => {
    expect(apiErrorSchema.safeParse({ ...error, ...fields }).success).toBe(false);
  });
});

describe('usage', () => {
  const usage = { inputTokens: 100, outputTokens: 25, cachedTokens: 40, turns: 2, durationMs: 500 };
  const counters = ['inputTokens', 'outputTokens', 'cachedTokens', 'turns', 'durationMs'] as const;

  test('accepts reported counters without inventing a dollar estimate', () => {
    const parsed = usageSchema.parse(usage);
    expect(parsed).toEqual(usage);
    expect(parsed).not.toHaveProperty('estimatedUsd');
    expectTypeOf(parsed).toEqualTypeOf<Usage>();
  });

  test('accepts zero counters and finite nonnegative dollar estimates, including fractions', () => {
    expect(usageSchema.parse(Object.fromEntries(counters.map((key) => [key, 0])))).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      turns: 0,
      durationMs: 0,
    });
    for (const estimatedUsd of [0, 0.001, 1.25]) {
      expect(usageSchema.parse({ ...usage, estimatedUsd })).toEqual({ ...usage, estimatedUsd });
    }
  });

  test.each(counters)('requires a safe nonnegative integer for %s', (field) => {
    for (const value of [undefined, null, '1', -1, 0.5, Number.NaN, Infinity, 2 ** 53]) {
      expect(usageSchema.safeParse({ ...usage, [field]: value }).success).toBe(false);
    }
  });

  test.each([-0.01, Number.NaN, Infinity, -Infinity, null, '0.01'])(
    'rejects invalid dollar estimates: %j',
    (estimatedUsd) => {
      expect(usageSchema.safeParse({ ...usage, estimatedUsd }).success).toBe(false);
    },
  );
});
