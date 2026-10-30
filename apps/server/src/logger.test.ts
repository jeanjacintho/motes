import { Writable } from 'node:stream';
import { expect, it } from 'vitest';
import { createLogger } from './logger.js';

it('redacts credentials in structured log fields and headers', () => {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const logger = createLogger('info', destination);
  logger.info({
    authorization: 'a',
    token: 'b',
    secret: 'c',
    password: 'd',
    req: { headers: { authorization: 'Bearer private' } },
  });
  expect(output).not.toContain('Bearer private');
  expect(JSON.parse(output)).toMatchObject({
    authorization: '[Redacted]',
    token: '[Redacted]',
    secret: '[Redacted]',
    password: '[Redacted]',
    req: { headers: { authorization: '[Redacted]' } },
  });
});
