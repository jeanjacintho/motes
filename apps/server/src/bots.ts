import { getBot, listBots } from '@motes/domain';
import { botDetailSchema, botSummarySchema } from '@motes/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from './composition.js';
import { route } from './route.js';

const idParams = z.object({ id: z.string().min(1) });

// Authentication comes from the server-wide hook; these routes only translate HTTP to the domain.
export function registerBotRoutes(server: FastifyInstance, services: Services) {
  route(server, {
    method: 'GET',
    url: '/bots',
    response: z.array(botSummarySchema),
    handler: () => listBots(services),
  });
  route(server, {
    method: 'GET',
    url: '/bots/:id',
    params: idParams,
    response: botDetailSchema,
    handler: ({ params }) => getBot(services, services.skillsDir, params.id),
  });
}
