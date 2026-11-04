import { ApiError, type createApiClient } from '@motes/core';
import {
  addRepositoryInputSchema,
  assignCardBodySchema,
  boardFiltersSchema,
  botConfigPatchSchema,
  commentInputSchema,
  createBotInputSchema,
  createCardInputSchema,
  createLabelInputSchema,
  createProjectInputSchema,
  moveCardBodySchema,
  newId,
  patchRepositoryBodySchema,
  projectSchema,
  putBotSkillBodySchema,
  repositoryPathSchema,
  repositorySchema,
  updateCardInputSchema,
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
  z.strictObject({ action: z.literal('bots.get'), id }),
  z.strictObject({ action: z.literal('bots.create'), input: createBotInputSchema }),
  z.strictObject({ action: z.literal('bots.updateSkill'), id, body: putBotSkillBodySchema }),
  z.strictObject({
    action: z.literal('bots.updateConfig'),
    id,
    patch: botConfigPatchSchema,
  }),
  z.strictObject({ action: z.literal('bots.remove'), id }),
  z.strictObject({ action: z.literal('bots.history'), id }),
  z.strictObject({
    action: z.literal('bots.revert'),
    id,
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
  }),
  z.strictObject({
    action: z.literal('cards.create'),
    projectId: id,
    input: createCardInputSchema,
  }),
  z.strictObject({ action: z.literal('cards.get'), id }),
  z.strictObject({ action: z.literal('cards.update'), id, patch: updateCardInputSchema }),
  z.strictObject({ action: z.literal('cards.assign'), id, body: assignCardBodySchema }),
  z.strictObject({ action: z.literal('cards.attachLabel'), id, labelId: id }),
  z.strictObject({ action: z.literal('cards.detachLabel'), id, labelId: id }),
  z.strictObject({ action: z.literal('labels.list'), projectId: id }),
  z.strictObject({
    action: z.literal('labels.create'),
    projectId: id,
    input: createLabelInputSchema,
  }),
  z.strictObject({
    action: z.literal('comments.timeline'),
    cardId: id,
    cursor: z.string().min(1).max(500).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  z.strictObject({ action: z.literal('comments.add'), cardId: id, input: commentInputSchema }),
  z.strictObject({ action: z.literal('comments.edit'), id, input: commentInputSchema }),
  z.strictObject({ action: z.literal('comments.remove'), id }),
]);
export type ApiRequest = z.input<typeof requestSchema>;
export type ApiResult =
  | { ok: true; value: unknown }
  | { ok: false; unauthorized: boolean; code?: string; issues?: FolderIssue[] };

/** Where a refused bot write went wrong: the file, the field and what is wrong with it. */
export type FolderIssue = { file: string; path: string; message: string };

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
    case 'bots.get':
      return client.bots.get(request.id, null);
    case 'bots.create':
      return client.bots.create(request.input, null);
    case 'bots.updateSkill':
      return client.bots.updateSkill(request.id, request.body.skill, null);
    case 'bots.updateConfig':
      return client.bots.updateConfig(request.id, request.patch, null);
    case 'bots.remove':
      return client.bots.remove(request.id, { removed: false });
    case 'bots.history':
      return client.bots.history(request.id, []);
    case 'bots.revert':
      return client.bots.revert(request.id, request.commit, null);
    case 'cards.create':
      return client.cards.create(request.projectId, request.input, null);
    case 'cards.get':
      return client.cards.get(request.id, null);
    case 'cards.update':
      return client.cards.update(request.id, request.patch, null);
    case 'cards.assign':
      return client.cards.assign(request.id, request.body, null);
    case 'cards.attachLabel':
      return client.cards.attachLabel(request.id, request.labelId, null);
    case 'cards.detachLabel':
      return client.cards.detachLabel(request.id, request.labelId, null);
    case 'labels.list':
      return client.labels.list(request.projectId, []);
    case 'labels.create':
      return client.labels.create(request.projectId, request.input, null);
    case 'comments.timeline':
      return client.comments.timeline(
        request.cardId,
        { cursor: request.cursor, limit: request.limit },
        { items: [], nextCursor: null },
      );
    case 'comments.add':
      return client.comments.add(request.cardId, request.input, null);
    case 'comments.edit':
      return client.comments.edit(request.id, request.input, null);
    case 'comments.remove':
      return client.comments.remove(request.id, { deleted: true });
  }
}

const issueText = (value: unknown) => (typeof value === 'string' ? value.slice(0, 300) : undefined);

/**
 * The file, field and message of a refused bot write, which the screens show next to the editor.
 * Only these three strings of a validation error cross the bridge, a few of them, and cut short.
 */
function folderIssues(error: ApiError): FolderIssue[] {
  const { details } = error.envelope as { details?: unknown };
  if (error.code !== 'validation_failed' || !Array.isArray(details)) return [];
  return details
    .flatMap((item): FolderIssue[] => {
      const issue = item as { file?: unknown; path?: unknown; message?: unknown } | null;
      const file = issueText(issue?.file);
      const message = issueText(issue?.message);
      if (file === undefined || message === undefined) return [];
      return [{ file, path: issueText(issue?.path) ?? '', message }];
    })
    .slice(0, 20);
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
      if (error instanceof ApiError) {
        const issues = folderIssues(error);
        return {
          ok: false,
          unauthorized: error.status === 401,
          code: error.code,
          ...(issues.length > 0 ? { issues } : {}),
        };
      }
      return { ok: false, unauthorized: false };
    }
  };
}
