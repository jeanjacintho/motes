import {
  botHistory,
  createBot,
  getBot,
  listBots,
  removeBot,
  revertBot,
  updateBotConfig,
  updateBotSkill,
} from '@motes/domain';
import {
  botConfigPatchSchema,
  botDetailSchema,
  botHistoryEntrySchema,
  botHistoryQuerySchema,
  botSummarySchema,
  createBotInputSchema,
  putBotSkillBodySchema,
  removeBotResponseSchema,
  revertBotParamsSchema,
} from '@motes/protocol';
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
  // Every write below validates first, writes atomically and commits to the skills repository.
  route(server, {
    method: 'POST',
    url: '/bots',
    body: createBotInputSchema,
    response: botDetailSchema,
    status: 201,
    handler: ({ body }) => createBot(services, services.skillsDir, body),
  });
  route(server, {
    method: 'PUT',
    url: '/bots/:id/skill',
    params: idParams,
    body: putBotSkillBodySchema,
    response: botDetailSchema,
    handler: ({ params, body }) =>
      updateBotSkill(services, services.skillsDir, params.id, body.skill),
  });
  route(server, {
    method: 'PATCH',
    url: '/bots/:id/config',
    params: idParams,
    body: botConfigPatchSchema,
    response: botDetailSchema,
    handler: ({ params, body }) => updateBotConfig(services, services.skillsDir, params.id, body),
  });
  route(server, {
    method: 'DELETE',
    url: '/bots/:id',
    params: idParams,
    response: removeBotResponseSchema,
    handler: async ({ params }) => {
      await removeBot(services, services.skillsDir, params.id);
      return { removed: true };
    },
  });
  route(server, {
    method: 'GET',
    url: '/bots/:id/history',
    params: idParams,
    query: botHistoryQuerySchema,
    response: z.array(botHistoryEntrySchema),
    handler: ({ params, query }) =>
      botHistory(services, services.skillsDir, params.id, query.limit),
  });
  route(server, {
    method: 'POST',
    url: '/bots/:id/revert/:commit',
    params: revertBotParamsSchema,
    response: botDetailSchema,
    handler: ({ params }) => revertBot(services, services.skillsDir, params.id, params.commit),
  });
}
