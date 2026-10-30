import { describe, expect, expectTypeOf, test, vi } from 'vitest';
import { z } from 'zod';
import { API_ERROR_CODES, apiErrorSchema, parseWithFallback, tolerantEnum } from './index.js';

describe('parseWithFallback', () => {
  const schema = z.object({ name: z.string(), count: z.number().default(0) });
  const fallback = { name: 'Unavailable', count: 0 };

  test('preserves known fields, strips extra fields and applies schema defaults', () => {
    const logger = vi.fn();
    const data = { name: 'First', futureField: true };
    expect(parseWithFallback(schema, data, fallback, logger)).toEqual({ name: 'First', count: 0 });
    expect(data).toEqual({ name: 'First', futureField: true });
    expect(logger).not.toHaveBeenCalled();
  });

  test('returns the configured fallback and reports validation issues for missing fields', () => {
    const logger = vi.fn();
    expect(parseWithFallback(schema, {}, fallback, logger)).toBe(fallback);
    expect(logger).toHaveBeenCalledExactlyOnceWith(expect.any(z.ZodError));
    expect(logger.mock.calls[0]?.[0].issues).toEqual([
      expect.objectContaining({ code: 'invalid_type', path: ['name'] }),
    ]);
  });

  test.each([null, undefined, 42, [], { name: 42 }, { name: 'First', count: '2' }])(
    'returns the fallback for malformed data: %j',
    (data) => {
      const logger = vi.fn();
      expect(parseWithFallback(schema, data, fallback, logger)).toBe(fallback);
      expect(logger).toHaveBeenCalledOnce();
    },
  );

  test('returns the schema output type, including transforms', () => {
    const length = z.string().transform((value) => value.length);
    const result = parseWithFallback(length, 'hello', 0, vi.fn());
    expect(result).toBe(5);
    expectTypeOf(result).toEqualTypeOf<number>();
    // @ts-expect-error A fallback must match the schema output, not its input.
    parseWithFallback(length, 'hello', 'invalid fallback', vi.fn());
  });
});

describe('tolerantEnum', () => {
  const schema = tolerantEnum(['todo', 'done'] as const);

  test.each(['todo', 'done', 'unknown'] as const)('preserves %s', (value) => {
    expect(schema.parse(value)).toBe(value);
  });

  test.each(['future-status', '', 'TODO'])('maps unknown strings to unknown: %j', (value) => {
    const result = schema.parse(value);
    expect(result).toBe('unknown');
    expectTypeOf(result).toEqualTypeOf<'todo' | 'done' | 'unknown'>();
  });

  test.each([null, undefined, 42, true, {}, []])('rejects non-string values: %j', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  test('composes with shared schemas while server enum validation stays strict', () => {
    const clientSchema = apiErrorSchema.extend({ code: tolerantEnum(API_ERROR_CODES) });
    const data = { code: 'future_error', message: 'New error', requestId: 'req-123' };
    expect(parseWithFallback(clientSchema, data, { ...data, code: 'unknown' }, vi.fn())).toEqual({
      ...data,
      code: 'unknown',
    });
    expect(apiErrorSchema.safeParse(data).success).toBe(false);
  });
});
