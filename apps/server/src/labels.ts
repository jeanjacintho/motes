import { attachLabel, createLabel, detachLabel, listLabels } from '@motes/domain';
import { cardSchema, createLabelInputSchema, labelSchema } from '@motes/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from './composition.js';
import { route } from './route.js';

const idParams = z.object({ id: z.string().min(1) });
const cardLabelParams = z.object({ id: z.string().min(1), labelId: z.string().min(1) });

// Authentication comes from the server-wide hook; these routes only translate HTTP to the domain.
export function registerLabelRoutes(server: FastifyInstance, services: Services) {
  route(server, {
    method: 'GET',
    url: '/projects/:id/labels',
    params: idParams,
    response: z.array(labelSchema),
    handler: ({ params }) => listLabels(services, params.id),
  });
  route(server, {
    method: 'POST',
    url: '/projects/:id/labels',
    params: idParams,
    body: createLabelInputSchema,
    response: labelSchema,
    status: 201,
    handler: ({ params, body }) => createLabel(services, params.id, body),
  });
  // Both are idempotent: attaching a label the card has, or detaching one it lacks, changes nothing.
  route(server, {
    method: 'PUT',
    url: '/cards/:id/labels/:labelId',
    params: cardLabelParams,
    response: cardSchema,
    handler: ({ params }) => attachLabel(services, params.id, params.labelId),
  });
  route(server, {
    method: 'DELETE',
    url: '/cards/:id/labels/:labelId',
    params: cardLabelParams,
    response: cardSchema,
    handler: ({ params }) => detachLabel(services, params.id, params.labelId),
  });
}
