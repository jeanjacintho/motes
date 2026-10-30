import { Conflict, Forbidden, NotFound, ValidationFailed } from '@motes/domain';
import { apiErrorSchema } from '@motes/protocol';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { z } from 'zod';

class InvalidOutput extends Error {}

export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    let status = 500;
    let code: 'not_found' | 'conflict' | 'unauthorized' | 'validation_failed' | 'internal' =
      'internal';
    let message = 'Internal server error';
    let details: unknown;
    if (error instanceof NotFound) {
      status = 404;
      code = 'not_found';
      message = error.message || 'Resource not found';
    } else if (error instanceof Conflict) {
      status = 409;
      code = 'conflict';
      message = error.message || 'Conflict';
    } else if (error instanceof Forbidden) {
      status = 403;
      code = 'unauthorized';
      message = error.message || 'Forbidden';
    } else if (error instanceof ValidationFailed) {
      status = 400;
      code = 'validation_failed';
      message = error.message || 'Validation failed';
      details = error.details;
    } else if (error instanceof z.ZodError) {
      status = 400;
      code = 'validation_failed';
      message = 'Invalid request';
      details = error.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
      }));
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      status = error.statusCode;
      code = 'validation_failed';
      message = 'Invalid request';
    } else {
      request.log.error({ err: error }, 'Request failed');
    }
    const envelope = apiErrorSchema.parse({
      code,
      message,
      requestId: request.id,
      ...(details === undefined ? {} : { details }),
    });
    void reply.code(status).send(envelope);
  });
}

export function route<Body extends z.ZodType, Query extends z.ZodType>(
  app: FastifyInstance,
  options: {
    method: HTTPMethods;
    url: string;
    body?: Body;
    query?: Query;
    response: z.ZodType;
    handler: (input: {
      body: z.output<Body>;
      query: z.output<Query>;
    }) => unknown | Promise<unknown>;
  },
) {
  app.route({
    method: options.method,
    url: options.url,
    handler: async (request) => {
      const body = options.body?.parse(request.body) as z.output<Body>;
      const query = options.query?.parse(request.query) as z.output<Query>;
      const result = await options.handler({ body, query });
      const parsed = options.response.safeParse(result);
      if (!parsed.success) throw new InvalidOutput('Invalid response');
      return parsed.data;
    },
  });
}
