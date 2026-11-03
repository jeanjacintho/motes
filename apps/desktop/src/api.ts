import { ApiError, type createApiClient } from '@motes/core';
import {
  addRepositoryInputSchema,
  boardFiltersSchema,
  createProjectInputSchema,
  moveCardBodySchema,
  newId,
  patchRepositoryBodySchema,
  projectSchema,
  repositoryPathSchema,
  repositorySchema,
} from '@motes/protocol';
import { z } from 'zod';
import { assertTrustedSender } from './security';

type Client = ReturnType<typeof createApiClient>;
type Frame = { url: string };
type Sender = { mainFrame: Frame };
export type ApiService = { api<T>(operation: (client: Client) => Promise<T>): Promise<T> };

const id = z.string().min(1).max(200);
const requestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('projects.list'), includeArchived: z.boolean().optional() }),
  z.strictObject({ action: z.literal('projects.create'), input: createProjectInputSchema }),
  z.strictObject({ action: z.literal('projects.rename'), id, name: z.string().max(500) }),
  z.strictObject({ action: z.literal('projects.archive'), id }),
  z.strictObject({ action: z.literal('repositories.list'), projectId: id }),
  z.strictObject({
    action: z.literal('repositories.add'),
    projectId: id,
    input: addRepositoryInputSchema,
  }),
  z.strictObject({
    action: z.literal('repositories.update'),
    id,
    patch: patchRepositoryBodySchema,
  }),
  z.strictObject({ action: z.literal('repositories.remove'), id }),
  z.strictObject({
    action: z.literal('repositories.setPath'),
    id,
    runtimeId: id,
    localPath: z.string().max(4096),
  }),
  z.strictObject({
    action: z.literal('cards.board'),
    projectId: id,
    filters: boardFiltersSchema.optional(),
  }),
  z.strictObject({ action: z.literal('cards.move'), id, body: moveCardBodySchema }),
  z.strictObject({ action: z.literal('bots.list') }),
]);
export type ApiRequest = z.input<typeof requestSchema>;
export type ApiResult =
  | { ok: true; value: unknown }
  | { ok: false; unauthorized: boolean; code?: string };

// The client needs a fallback for malformed server responses. The pairing service turns those
// into errors before returning, so these placeholders never reach the renderer.
const epoch = new Date(0).toISOString();
const project = projectSchema.parse({
  id: newId('project'),
  key: 'XX',
  name: 'placeholder',
  description: '',
  createdAt: epoch,
});
const repository = repositorySchema.parse({
  id: newId('repository'),
  projectId: project.id,
  name: 'placeholder',
  remoteUrl: 'placeholder',
  defaultBranch: 'main',
  isPrimary: false,
});
const path = repositoryPathSchema.parse({
  repositoryId: repository.id,
  runtimeId: newId('runtime'),
  localPath: '/',
});

function dispatch(request: z.output<typeof requestSchema>, client: Client): Promise<unknown> {
  switch (request.action) {
    case 'projects.list':
      return client.projects.list({ includeArchived: request.includeArchived ?? false }, []);
    case 'projects.create':
      return client.projects.create(request.input, project);
    case 'projects.rename':
      return client.projects.rename(request.id, request.name, project);
    case 'projects.archive':
      return client.projects.archive(request.id, project);
    case 'repositories.list':
      return client.repositories.list(request.projectId, []);
    case 'repositories.add':
      return client.repositories.add(request.projectId, request.input, repository);
    case 'repositories.update':
      return client.repositories.update(request.id, request.patch, repository);
    case 'repositories.remove':
      return client.repositories.remove(request.id, { removed: false });
    case 'repositories.setPath':
      return client.repositories.setPath(request.id, request.runtimeId, request.localPath, path);
    case 'cards.board':
      return client.cards.board(request.projectId, request.filters ?? {}, { columns: [] });
    case 'cards.move':
      return client.cards.move(request.id, request.body, null);
    case 'bots.list':
      return client.bots.list([]);
  }
}

export function createApiHandler(sender: Sender, appUrl: string, service: ApiService) {
  return async (
    event: { sender: Sender; senderFrame: Frame | null },
    ...args: unknown[]
  ): Promise<ApiResult> => {
    assertTrustedSender(event, sender.mainFrame, appUrl);
    const parsed = requestSchema.safeParse(args[0]);
    if (event.sender !== sender || args.length !== 1 || !parsed.success)
      throw new Error('Invalid IPC request');
    try {
      return { ok: true, value: await service.api((client) => dispatch(parsed.data, client)) };
    } catch (error) {
      // Only the status class and protocol code cross the bridge, never messages or payloads.
      if (error instanceof ApiError)
        return { ok: false, unauthorized: error.status === 401, code: error.code };
      return { ok: false, unauthorized: false };
    }
  };
}
