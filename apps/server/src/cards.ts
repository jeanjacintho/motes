import {
  addComment,
  assignCard,
  createCard,
  deleteComment,
  editComment,
  getBoard,
  getCard,
  getTimeline,
  moveCard,
  updateCard,
} from '@motes/domain';
import {
  assignCardBodySchema,
  boardFiltersFromQuery,
  boardQuerySchema,
  boardSchema,
  cardSchema,
  commentInputSchema,
  commentSchema,
  createCardInputSchema,
  deleteCommentResponseSchema,
  moveCardBodySchema,
  timelinePageSchema,
  timelineQuerySchema,
  updateCardInputSchema,
} from '@motes/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from './composition.js';
import { route } from './route.js';

const idParams = z.object({ id: z.string().min(1) });
const refParams = z.object({ ref: z.string().min(1) });

// Authentication comes from the server-wide hook; these routes only translate HTTP to the domain.
export function registerCardRoutes(server: FastifyInstance, services: Services) {
  route(server, {
    method: 'POST',
    url: '/projects/:id/cards',
    params: idParams,
    body: createCardInputSchema,
    response: cardSchema,
    status: 201,
    handler: ({ params, body }) => createCard(services, params.id, body),
  });
  route(server, {
    method: 'GET',
    url: '/cards/:ref',
    params: refParams,
    response: cardSchema,
    handler: ({ params }) => getCard(services, params.ref),
  });
  route(server, {
    method: 'PATCH',
    url: '/cards/:id',
    params: idParams,
    body: updateCardInputSchema,
    response: cardSchema,
    handler: ({ params, body }) => updateCard(services, params.id, body),
  });
  route(server, {
    method: 'POST',
    url: '/cards/:id/move',
    params: idParams,
    body: moveCardBodySchema,
    response: cardSchema,
    handler: ({ params, body }) =>
      moveCard(
        services,
        params.id,
        body.status,
        { beforeId: body.beforeId, afterId: body.afterId },
        undefined,
        body.reason,
      ),
  });
  route(server, {
    method: 'POST',
    url: '/cards/:id/assign',
    params: idParams,
    body: assignCardBodySchema,
    response: cardSchema,
    handler: ({ params, body }) => assignCard(services, params.id, body.assignee),
  });
  route(server, {
    method: 'GET',
    url: '/projects/:id/board',
    params: idParams,
    query: boardQuerySchema,
    response: boardSchema,
    handler: ({ params, query }) => getBoard(services, params.id, boardFiltersFromQuery(query)),
  });
  route(server, {
    method: 'GET',
    url: '/cards/:id/timeline',
    params: idParams,
    query: timelineQuerySchema,
    response: timelinePageSchema,
    handler: ({ params, query }) => getTimeline(services, params.id, query),
  });
  route(server, {
    method: 'POST',
    url: '/cards/:id/comments',
    params: idParams,
    body: commentInputSchema,
    response: commentSchema,
    status: 201,
    handler: ({ params, body }) => addComment(services, params.id, body.body),
  });
  route(server, {
    method: 'PATCH',
    url: '/comments/:id',
    params: idParams,
    body: commentInputSchema,
    response: commentSchema,
    handler: ({ params, body }) => editComment(services, params.id, body.body),
  });
  route(server, {
    method: 'DELETE',
    url: '/comments/:id',
    params: idParams,
    response: deleteCommentResponseSchema,
    handler: async ({ params }) => {
      await deleteComment(services, params.id);
      return { deleted: true };
    },
  });
}
