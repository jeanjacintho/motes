import { describe, expect, it } from 'vitest';
import { positionBetween } from './position.js';

// Positions compare as plain strings, byte by byte, exactly like COLLATE "C" in Postgres.
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe('positionBetween', () => {
  it('starts an empty column in the middle of the alphabet', () => {
    expect(positionBetween(undefined, undefined)).toBe('V');
  });

  it('puts a key before, after and between existing ones', () => {
    const first = positionBetween(undefined, undefined);
    expect(positionBetween(undefined, first) < first).toBe(true);
    expect(positionBetween(first, undefined) > first).toBe(true);
    const between = positionBetween('V', 'W');
    expect('V' < between && between < 'W').toBe(true);
  });

  it('rejects neighbours that are not in order and keys that end in the lowest digit', () => {
    expect(() => positionBetween('b', 'a')).toThrow();
    expect(() => positionBetween('a', 'a')).toThrow();
    expect(() => positionBetween('a0', undefined)).toThrow();
    expect(() => positionBetween(undefined, 'a0')).toThrow();
  });

  it('keeps 1000 random insertions unique and ordered, and keys short', () => {
    let seed = 1984;
    const random = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };
    const keys: string[] = [];
    for (let index = 0; index < 1000; index++) {
      const at = random(keys.length + 1);
      keys.splice(at, 0, positionBetween(keys[at - 1], keys[at]));
    }
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort(compare)).toEqual(keys);
    for (const key of keys) expect(key.endsWith('0')).toBe(false);
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThan(40);
  });

  it('stays valid when always inserting at the same spot', () => {
    const keys = ['V'];
    for (let index = 0; index < 200; index++) keys.unshift(positionBetween(undefined, keys[0]));
    for (let index = 1; index < keys.length; index++)
      expect((keys[index - 1] as string) < (keys[index] as string)).toBe(true);
  });
});
