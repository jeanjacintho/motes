import { expect, test } from 'vitest';
import * as protocol from './index.js';

test('loads the protocol entry point in Node without a DOM', () => {
  expect(protocol).toBeTypeOf('object');
  expect(process.release.name).toBe('node');
  expect(globalThis).not.toHaveProperty('document');
});
