import { describe, expect, expectTypeOf, test, vi } from 'vitest';
import { z } from 'zod';
import {
  defineEvent,
  type EventId,
  eventEnvelopeSchema,
  eventRegistry,
  parseClientEvent,
  parseEvent,
} from './index.js';

const ping = {
  id: 'evt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  type: 'system.ping',
  occurredAt: '2026-10-30T08:00:00.123Z',
  actor: { kind: 'system' },
  subject: { kind: 'system', id: 'hub' },
  payload: {},
};

describe('event contracts', () => {
  test('round-trips a registered event without changing its envelope or payload', () => {
    const event = parseEvent(JSON.parse(JSON.stringify(ping)));
    expect(event).toEqual(ping);
    expectTypeOf(event.id).toEqualTypeOf<EventId>();
    expectTypeOf(event.type).toEqualTypeOf<'system.ping'>();
    expect(eventRegistry['system.ping'].type).toBe('system.ping');
    expect(parseClientEvent(ping, vi.fn())).toEqual(event);
  });

  test('defines a descriptor that validates and infers a feature payload', () => {
    const descriptor = defineEvent('example.counted', z.object({ count: z.number().int() }));
    const event = descriptor.schema.parse({
      ...ping,
      type: descriptor.type,
      payload: { count: 3 },
    });
    expect(event.payload).toEqual({ count: 3 });
    expectTypeOf(event.type).toEqualTypeOf<'example.counted'>();
    expectTypeOf(event.payload).toEqualTypeOf<{ count: number }>();
    expect(() => descriptor.schema.parse({ ...event, payload: { count: '3' } })).toThrow(
      z.ZodError,
    );
  });

  test('preserves a future event as unknown and continues with the next known event', () => {
    const logger = vi.fn();
    const future = { ...ping, type: 'future.created', payload: { nested: [1, true, null] } };
    expect([future, ping].map((raw) => parseClientEvent(raw, logger))).toEqual([
      { ...future, type: 'unknown', originalType: 'future.created' },
      ping,
    ]);
    expect(logger).not.toHaveBeenCalled();
    expect(() => parseEvent(future)).toThrow(z.ZodError);
  });

  test.each([undefined, null, [], 'ping', 1, { unexpected: true }])(
    'rejects invalid known payloads on the server and reports them on the client: %j',
    (payload) => {
      const raw = { ...ping, payload };
      expect(() => parseEvent(raw)).toThrow(z.ZodError);
      const logger = vi.fn();
      expect(parseClientEvent(raw, logger)).toBeNull();
      expect(logger).toHaveBeenCalledExactlyOnceWith(expect.any(z.ZodError));
    },
  );

  test.each([
    { id: 'card_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    { type: '' },
    { occurredAt: 'yesterday' },
    { actor: { kind: 'bot', id: '' } },
    { subject: { kind: '', id: 'hub' } },
    { subject: { kind: 'system' } },
    { payload: undefined },
    { payload: { invalid: Infinity } },
  ])('rejects malformed envelopes: %j', (fields) => {
    const raw = { ...ping, ...fields };
    expect(eventEnvelopeSchema.safeParse(raw).success).toBe(false);
    expect(parseClientEvent(raw, vi.fn())).toBeNull();
  });

  test.each(['owner', 'bot', 'system', 'runtime'] as const)('preserves the %s actor', (kind) => {
    expect(parseEvent({ ...ping, actor: { kind, id: 'actor-id' } }).actor).toEqual({
      kind,
      id: 'actor-id',
    });
  });

  test('strips future envelope fields on clients', () => {
    expect(parseClientEvent({ ...ping, futureField: true }, vi.fn())).toEqual(ping);
  });

  test('rejects future actor kinds on the server and tolerates them on clients', () => {
    const raw = { ...ping, actor: { kind: 'visitor', id: 'future-actor' } };
    expect(() => parseEvent(raw)).toThrow(z.ZodError);
    expect(parseClientEvent(raw, vi.fn())).toEqual({
      ...raw,
      actor: { kind: 'unknown', id: 'future-actor' },
    });
  });

  test.each([null, undefined, 42, [], {}])('logs malformed messages and skips them: %j', (raw) => {
    const logger = vi.fn();
    expect(parseClientEvent(raw, logger)).toBeNull();
    expect(logger).toHaveBeenCalledExactlyOnceWith(expect.any(z.ZodError));
  });

  test.each(['unknown', 'toString', '__proto__'])('handles unregistered type %s safely', (type) => {
    const raw = { ...ping, type, payload: null };
    const parsed = parseClientEvent(raw, vi.fn());
    expect(parsed).toEqual({ ...raw, type: 'unknown', originalType: type });
    if (parsed?.type === 'unknown') {
      expectTypeOf(parsed.originalType).toEqualTypeOf<string>();
    } else if (parsed) {
      expectTypeOf(parsed.type).toEqualTypeOf<'system.ping'>();
      expectTypeOf(parsed.payload).toEqualTypeOf<Record<string, never>>();
    }
  });
});
