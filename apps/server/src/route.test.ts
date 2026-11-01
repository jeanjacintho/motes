import { Conflict, Forbidden, NotFound, ValidationFailed } from '@motes/domain';
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
  it.each([
    [new NotFound(), 404, 'not_found'],
    [new Conflict(''), 409, 'conflict'],
    [new Forbidden(), 403, 'unauthorized'],
    [new ValidationFailed(''), 400, 'validation_failed'],
  ] as const)('preserves the response for an empty domain error', async (error, status, code) => {
    const app = Fastify();
    installErrorHandler(app);
    route(app, {
      method: 'GET',
      url: '/test',
      response: z.string(),
      handler: () => {
        throw error;
      },
    });
    const response = await app.inject('/test');
    expect(response.statusCode).toBe(status);
    expect(apiErrorSchema.parse(response.json())).toMatchObject({
      code,
      message: expect.any(String),
      requestId: expect.any(String),
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
  it('parses path parameters and applies a configured success status', async () => {
    const app = Fastify();
    installErrorHandler(app);
    route(app, {
      method: 'POST',
      url: '/things/:id',
      params: z.object({ id: z.string().min(3) }),
      body: z.object({ n: z.number() }),
      response: z.object({ id: z.string(), n: z.number() }),
      status: 201,
      handler: ({ params, body }) => ({ id: params.id, n: body.n }),
    });
    const created = await app.inject({ method: 'POST', url: '/things/abc', payload: { n: 1 } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ id: 'abc', n: 1 });
    const invalid = await app.inject({ method: 'POST', url: '/things/ab', payload: { n: 1 } });
    expect(invalid.statusCode).toBe(400);
    expect(apiErrorSchema.parse(invalid.json())).toMatchObject({
      code: 'validation_failed',
      details: [{ path: ['id'] }],
    });
    await app.close();
  });
});
