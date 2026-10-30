import { describe, expect, test } from 'vitest';
import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  test('sorts keys recursively, including numeric-looking keys, without whitespace', () => {
    expect(canonicalJson({ z: { b: 2, a: 1 }, '2': true, '10': null })).toBe(
      '{"10":null,"2":true,"z":{"a":1,"b":2}}',
    );
  });

  test('preserves nested array order and JSON string escaping', () => {
    expect(canonicalJson([{ b: ['two words', '\n"\\'], a: [2, 1] }])).toBe(
      '[{"a":[2,1],"b":["two words","\\n\\"\\\\"]}]',
    );
  });

  test.each([null, true, false, 0, -0, 1.25, '', 'olá'])('serializes %j', (value) => {
    expect(canonicalJson(value)).toBe(JSON.stringify(value));
  });

  test('supports null-prototype records and repeated references without mutation', () => {
    const shared = Object.freeze({ b: 2, a: 1 });
    const record = Object.assign(Object.create(null), { z: shared, a: shared });
    expect(canonicalJson(record)).toBe('{"a":{"a":1,"b":2},"z":{"a":1,"b":2}}');
    expect(Object.keys(shared)).toEqual(['b', 'a']);
  });

  test.each([undefined, () => 1, NaN, Infinity, -Infinity, 1n, Symbol('value')])(
    'rejects unsupported values at every depth: %s',
    (value) => {
      expect(() => canonicalJson(value)).toThrow(TypeError);
      expect(() => canonicalJson({ nested: { value } })).toThrow(TypeError);
      expect(() => canonicalJson([['valid', value]])).toThrow(TypeError);
    },
  );

  test.each([new Date(0), new Map(), new Set(), new Number(1), new Array(1)])(
    'rejects non-JSON containers: %s',
    (value) => {
      expect(() => canonicalJson(value)).toThrow(TypeError);
    },
  );

  test('rejects cycles in objects and arrays', () => {
    const object: Record<string, unknown> = {};
    object.self = object;
    const array: unknown[] = [];
    array.push(array);
    expect(() => canonicalJson(object)).toThrow(TypeError);
    expect(() => canonicalJson(array)).toThrow(TypeError);
  });
});
