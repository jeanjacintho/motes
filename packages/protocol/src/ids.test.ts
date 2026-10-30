import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import { type CardId, ID_PREFIXES, idSchema, newId, type RunId } from './index.js';

afterEach(() => vi.restoreAllMocks());

describe('entity ids', () => {
  test('sorts by millisecond timestamp, regardless of random suffix', () => {
    const clock = vi.spyOn(Date, 'now');
    const times = [0, 31, 32, 1023, 1024, 1_800_000_000_000, 2 ** 48 - 1];
    const ids = times.map((time) => {
      clock.mockReturnValue(time);
      return newId('card');
    });
    expect([...ids].reverse().sort()).toEqual(ids);
    expect(ids[0]?.slice(5, 15)).toBe('0000000000');
    expect(ids.at(-1)?.slice(5, 15)).toBe('7ZZZZZZZZZ');
  });

  test('generates valid, distinct ids for every registered entity at the same instant', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    for (const kind of Object.keys(ID_PREFIXES) as (keyof typeof ID_PREFIXES)[]) {
      const ids = Array.from({ length: 100 }, () => newId(kind));
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id.startsWith(ID_PREFIXES[kind])).toBe(true);
        expect(idSchema(kind).parse(id)).toBe(id);
      }
    }
  });

  test('parses canonical minimum and maximum bodies', () => {
    for (const body of ['00000000000000000000000000', '7ZZZZZZZZZZZZZZZZZZZZZZZZZ']) {
      expect(idSchema('card').parse(`card_${body}`)).toBe(`card_${body}`);
    }
  });

  test.each([
    'run_00000000000000000000000000',
    'card_0000000000000000000000000',
    'card_000000000000000000000000000',
    'card_80000000000000000000000000',
    ...['I', 'L', 'O', 'U', 'a', '-', ' '].map((char) => `card_0000000000000000000000000${char}`),
    'card_00000000000000000000000000\n',
    ' card_00000000000000000000000000',
    '',
    null,
    123,
  ])('rejects a wrong entity or malformed id: %j', (input) => {
    expect(idSchema('card').safeParse(input).success).toBe(false);
  });

  test.each([-1, 0.5, 2 ** 48, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects timestamps outside the 48-bit integer range: %s',
    (time) => {
      vi.spyOn(Date, 'now').mockReturnValue(time);
      expect(() => newId('card')).toThrow(RangeError);
    },
  );

  test('preserves entity brands through generation and parsing', () => {
    const card = newId('card');
    const run = newId('run');
    expectTypeOf(card).toEqualTypeOf<CardId>();
    expectTypeOf(run).toEqualTypeOf<RunId>();
    expectTypeOf(idSchema('card').parse(card)).toEqualTypeOf<CardId>();
    // @ts-expect-error A run id cannot be used as a card id.
    const wrongCard: CardId = run;
    // @ts-expect-error A card id cannot be used as a run id.
    const wrongRun: RunId = card;
    // @ts-expect-error Unvalidated strings cannot be used as card ids.
    const unvalidated: CardId = 'card_00000000000000000000000000';
    expect([wrongCard, wrongRun, unvalidated]).toEqual([run, card, unvalidated]);
  });
});
