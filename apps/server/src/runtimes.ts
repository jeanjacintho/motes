import { createDaemonToken } from '@motes/domain';
import { createRuntimeTokenBodySchema, runtimeTokenResponseSchema } from '@motes/protocol';
import type { FastifyInstance } from 'fastify';
import type { Services } from './composition.js';
import { route } from './route.js';

// Only a client (the owner's app) reaches this: daemon tokens are stopped by the route guard.
export function registerRuntimeRoutes(server: FastifyInstance, services: Services) {
  route(server, {
    method: 'POST',
    url: '/runtimes/tokens',
    body: createRuntimeTokenBodySchema,
    response: runtimeTokenResponseSchema,
    status: 201,
    handler: ({ body }) => createDaemonToken(services, body),
  });
}
