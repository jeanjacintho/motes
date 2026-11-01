import {
  addRepository,
  archiveProject,
  createProject,
  listProjects,
  listRepositories,
  listRepositoryPaths,
  removeRepository,
  renameProject,
  setPrimaryRepository,
  setRepositoryPath,
  updateRepository,
} from '@motes/domain';
import {
  addRepositoryInputSchema,
  createProjectInputSchema,
  idSchema,
  listProjectsQuerySchema,
  patchRepositoryBodySchema,
  projectSchema,
  removeRepositoryResponseSchema,
  renameProjectBodySchema,
  repositoryDetailSchema,
  repositoryPathSchema,
  repositorySchema,
  setRepositoryPathBodySchema,
} from '@motes/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from './composition.js';
import { route } from './route.js';

const idParams = z.object({ id: z.string().min(1) });
const pathParams = z.object({ id: z.string().min(1), runtimeId: idSchema('runtime') });

// Authentication comes from the server-wide hook; these routes only translate HTTP to the domain.
export function registerProjectRoutes(server: FastifyInstance, services: Services) {
  route(server, {
    method: 'GET',
    url: '/projects',
    query: listProjectsQuerySchema,
    response: z.array(projectSchema),
    handler: ({ query }) => listProjects(services, query),
  });
  route(server, {
    method: 'POST',
    url: '/projects',
    body: createProjectInputSchema,
    response: projectSchema,
    status: 201,
    handler: ({ body }) => createProject(services, body),
  });
  route(server, {
    method: 'PATCH',
    url: '/projects/:id',
    params: idParams,
    body: renameProjectBodySchema,
    response: projectSchema,
    handler: ({ params, body }) => renameProject(services, params.id, body.name),
  });
  route(server, {
    method: 'POST',
    url: '/projects/:id/archive',
    params: idParams,
    response: projectSchema,
    handler: ({ params }) => archiveProject(services, params.id),
  });
  route(server, {
    method: 'GET',
    url: '/projects/:id/repositories',
    params: idParams,
    response: z.array(repositoryDetailSchema),
    handler: async ({ params }) =>
      Promise.all(
        (await listRepositories(services, params.id)).map(async (repository) => ({
          ...repository,
          paths: (await listRepositoryPaths(services, repository.id)).map(
            ({ runtimeId, localPath }) => ({ runtimeId, localPath }),
          ),
        })),
      ),
  });
  route(server, {
    method: 'POST',
    url: '/projects/:id/repositories',
    params: idParams,
    body: addRepositoryInputSchema,
    response: repositorySchema,
    status: 201,
    handler: ({ params, body }) => addRepository(services, params.id, body),
  });
  route(server, {
    method: 'PATCH',
    url: '/repositories/:id',
    params: idParams,
    body: patchRepositoryBodySchema,
    response: repositorySchema,
    handler: async ({ params, body }) => {
      const { isPrimary, ...fields } = body;
      const updated = await updateRepository(services, params.id, fields);
      return isPrimary ? setPrimaryRepository(services, params.id) : updated;
    },
  });
  route(server, {
    method: 'DELETE',
    url: '/repositories/:id',
    params: idParams,
    response: removeRepositoryResponseSchema,
    handler: async ({ params }) => {
      await removeRepository(services, params.id);
      return { removed: true };
    },
  });
  route(server, {
    method: 'PUT',
    url: '/repositories/:id/paths/:runtimeId',
    params: pathParams,
    body: setRepositoryPathBodySchema,
    response: repositoryPathSchema,
    handler: ({ params, body }) =>
      setRepositoryPath(services, params.id, params.runtimeId, body.localPath),
  });
}
