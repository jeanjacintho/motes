import { NotFound } from '@motes/domain';
import { apiErrorSchema } from '@motes/protocol';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installErrorHandler, route } from './route.js';

describe('route contracts', () => {
  it('maps domain and input errors to protocol envelopes', async () => {
    const app = Fastify();
    installErrorHandler(app);
    route(app, {
      method: 'POST',
      url: '/test',
      body: z.object({ name: z.string() }),
      response: z.string(),
      handler: () => {
        throw new NotFound('Missing');
      },
    });
    const missing = await app.inject({ method: 'POST', url: '/test', payload: { name: 'x' } });
    expect(missing.statusCode).toBe(404);
    expect(apiErrorSchema.parse(missing.json())).toMatchObject({
      code: 'not_found',
      message: 'Missing',
    });
    const invalid = await app.inject({ method: 'POST', url: '/test', payload: { name: 4 } });
    expect(invalid.statusCode).toBe(400);
    expect(apiErrorSchema.parse(invalid.json())).toMatchObject({
      code: 'validation_failed',
      details: [{ path: ['name'] }],
    });
    await app.close();
  });
  it('treats invalid output as an internal error', async () => {
    const app = Fastify();
    installErrorHandler(app);
    route(app, { method: 'GET', url: '/test', response: z.string(), handler: () => 42 });
    const response = await app.inject('/test');
    expect(response.statusCode).toBe(500);
    expect(apiErrorSchema.parse(response.json()).code).toBe('internal');
    await app.close();
  });
});
