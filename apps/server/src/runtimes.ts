import { createDaemonToken, registerRuntime } from '@motes/domain';
import {
  createRuntimeTokenBodySchema,
  registerRuntimeBodySchema,
  runtimeSchema,
  runtimeTokenResponseSchema,
} from '@motes/protocol';
import type { FastifyInstance } from 'fastify';
import type { Services } from './composition.js';
import { route } from './route.js';

// The token route is the owner's app only and the /daemon routes are the daemon's only: both
// follow from the route guard in the auth hook.
export function registerRuntimeRoutes(server: FastifyInstance, services: Services) {
  route(server, {
    method: 'POST',
    url: '/runtimes/tokens',
    body: createRuntimeTokenBodySchema,
    response: runtimeTokenResponseSchema,
    status: 201,
    handler: ({ body }) => createDaemonToken(services, body),
  });
  // Idempotent per token: the same daemon registering again updates its runtime.
  route(server, {
    method: 'POST',
    url: '/daemon/register',
    body: registerRuntimeBodySchema,
    response: runtimeSchema,
    handler: ({ body, principal }) => {
      if (!principal) throw new Error('Authenticated request without a principal');
      return registerRuntime(services, principal.deviceId, body);
    },
  });
}
