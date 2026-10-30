import { describe, expect, test } from 'vitest';
import * as protocol from './index.js';
import { digest } from './node.js';

describe('digest (Node-only)', () => {
  test('returns the known SHA-256 hexadecimal digest of canonical JSON', () => {
    expect(digest({})).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  test('ignores object key order and insignificant whitespace in parsed JSON', () => {
    const first: unknown = JSON.parse('{ "b": { "z": 2, "a": 1 }, "a": 3 }');
    const second: unknown = JSON.parse('{"a":3,"b":{"a":1,"z":2}}');
    expect(digest(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(digest(first)).toBe(digest(second));
  });

  test('preserves nested array order and significant string whitespace', () => {
    expect(digest({ items: [[1, 2]] })).not.toBe(digest({ items: [[2, 1]] }));
    expect(digest('a b')).not.toBe(digest('ab'));
  });

  test.each([undefined, () => 1, NaN, Infinity, -Infinity])(
    'rejects invalid input rather than hashing a lossy representation: %s',
    (value) => {
      expect(() => digest(value)).toThrow(TypeError);
      expect(() => digest({ value })).toThrow(TypeError);
      expect(() => digest([value])).toThrow(TypeError);
    },
  );

  test('keeps digest out of the browser-safe root entry point', () => {
    expect(protocol.canonicalJson({})).toBe('{}');
    expect(protocol).not.toHaveProperty('digest');
  });
});
