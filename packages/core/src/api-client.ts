import {
  type AddRepositoryInput,
  API_ERROR_CODES,
  type AssignCardBody,
  apiErrorSchema,
  type Board,
  type BoardFilters,
  type BotDetail,
  boardFiltersToQuery,
  boardSchema,
  botDetailSchema,
  botSummarySchema,
  type CommentInput,
  type CreateCardInput,
  type CreateLabelInput,
  type CreateProjectInput,
  cardSchema,
  commentSchema,
  DEVICE_KINDS,
  deleteCommentResponseSchema,
  deviceResponseSchema,
  healthResponseSchema,
  labelSchema,
  type MoveCardBody,
  type ParseLogger,
  type PatchRepositoryBody,
  pairResponseSchema,
  parseWithFallback,
  projectSchema,
  removeRepositoryResponseSchema,
  repositoryDetailSchema,
  repositoryPathSchema,
  repositorySchema,
  revokeDeviceResponseSchema,
  type TimelinePage,
  timelineItemSchema,
  tolerantEnum,
  type UpdateCardInput,
} from '@motes/protocol';
import { z } from 'zod';
import { NetworkError } from './query-client.js';

const projectsSchema = z.array(projectSchema);
// Card calls fall back to null: a card that cannot be read is better absent than invented.
const maybeCardSchema = cardSchema.nullable();
const labelsSchema = z.array(labelSchema);
const maybeLabelSchema = labelSchema.nullable();
const maybeCommentSchema = commentSchema.nullable();
// A timeline line of a kind this client does not know is skipped, not a reason to lose the page.
const clientTimelinePageSchema = z.object({
  items: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = timelineItemSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  nextCursor: z.string().min(1).nullable(),
});
const botsSchema = z.array(botSummarySchema);
const maybeBotSchema = botDetailSchema.nullable();
const repositoryDetailsSchema = z.array(repositoryDetailSchema);
type Output<S extends z.ZodType> = z.output<S>;

const devicesSchema = z.array(deviceResponseSchema.extend({ kind: tolerantEnum(DEVICE_KINDS) }));

const clientErrorSchema = apiErrorSchema.extend({ code: tolerantEnum(API_ERROR_CODES) });
type ErrorEnvelope = z.output<typeof clientErrorSchema>;

export class ApiError extends Error {
  readonly code: ErrorEnvelope['code'];
  constructor(
    readonly envelope: ErrorEnvelope,
    readonly status: number,
  ) {
    super(envelope.message);
    this.name = 'ApiError';
    this.code = envelope.code;
  }
}

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Options = {
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
  fetch: Fetch;
  logger: ParseLogger;
};

export function createApiClient({ baseUrl, getToken, fetch, logger }: Options) {
  const base = baseUrl.replace(/\/+$/, '');
  async function request<S extends z.ZodType>(
    path: string,
    method: string,
    schema: S,
    fallback: z.output<S>,
    body?: unknown,
    authenticated = true,
  ): Promise<z.output<S>> {
    const headers: Record<string, string> = {};
    if (authenticated) {
      const token = await getToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method,
      headers,
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response: Awaited<ReturnType<Fetch>>;
    try {
      response = await fetch(`${base}${path}`, init);
    } catch (error) {
      throw new NetworkError(error);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    if (!response.ok) {
      const envelope = parseWithFallback(
        clientErrorSchema,
        data,
        { code: 'internal', message: `HTTP ${response.status}`, requestId: 'unknown' },
        logger,
      );
      throw new ApiError(envelope, response.status);
    }
    return parseWithFallback(schema, data, fallback, logger);
  }
  return {
    health: (fallback: z.output<typeof healthResponseSchema>) =>
      request('/health', 'GET', healthResponseSchema, fallback, undefined, false),
    pair: (input: { code: string; name: string }, fallback: z.output<typeof pairResponseSchema>) =>
      request('/pair', 'POST', pairResponseSchema.strip(), fallback, input, false),
    projects: {
      list: (options: { includeArchived?: boolean }, fallback: Output<typeof projectsSchema>) =>
        request(
          `/projects${options.includeArchived ? '?includeArchived=true' : ''}`,
          'GET',
          projectsSchema,
          fallback,
        ),
      create: (input: CreateProjectInput, fallback: Output<typeof projectSchema>) =>
        request('/projects', 'POST', projectSchema, fallback, input),
      rename: (id: string, name: string, fallback: Output<typeof projectSchema>) =>
        request(`/projects/${encodeURIComponent(id)}`, 'PATCH', projectSchema, fallback, { name }),
      archive: (id: string, fallback: Output<typeof projectSchema>) =>
        request(`/projects/${encodeURIComponent(id)}/archive`, 'POST', projectSchema, fallback),
    },
    repositories: {
      list: (projectId: string, fallback: Output<typeof repositoryDetailsSchema>) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/repositories`,
          'GET',
          repositoryDetailsSchema,
          fallback,
        ),
      add: (
        projectId: string,
        input: AddRepositoryInput,
        fallback: Output<typeof repositorySchema>,
      ) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/repositories`,
          'POST',
          repositorySchema,
          fallback,
          input,
        ),
      update: (id: string, patch: PatchRepositoryBody, fallback: Output<typeof repositorySchema>) =>
        request(
          `/repositories/${encodeURIComponent(id)}`,
          'PATCH',
          repositorySchema,
          fallback,
          patch,
        ),
      remove: (id: string, fallback: Output<typeof removeRepositoryResponseSchema>) =>
        request(
          `/repositories/${encodeURIComponent(id)}`,
          'DELETE',
          removeRepositoryResponseSchema,
          fallback,
        ),
      setPath: (
        id: string,
        runtimeId: string,
        localPath: string,
        fallback: Output<typeof repositoryPathSchema>,
      ) =>
        request(
          `/repositories/${encodeURIComponent(id)}/paths/${encodeURIComponent(runtimeId)}`,
          'PUT',
          repositoryPathSchema,
          fallback,
          { localPath },
        ),
    },
    cards: {
      get: (ref: string, fallback: null) =>
        request(`/cards/${encodeURIComponent(ref)}`, 'GET', maybeCardSchema, fallback),
      create: (projectId: string, input: CreateCardInput, fallback: null) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/cards`,
          'POST',
          maybeCardSchema,
          fallback,
          input,
        ),
      update: (id: string, patch: UpdateCardInput, fallback: null) =>
        request(`/cards/${encodeURIComponent(id)}`, 'PATCH', maybeCardSchema, fallback, patch),
      move: (id: string, body: MoveCardBody, fallback: null) =>
        request(`/cards/${encodeURIComponent(id)}/move`, 'POST', maybeCardSchema, fallback, body),
      assign: (id: string, body: AssignCardBody, fallback: null) =>
        request(`/cards/${encodeURIComponent(id)}/assign`, 'POST', maybeCardSchema, fallback, body),
      attachLabel: (id: string, labelId: string, fallback: null) =>
        request(
          `/cards/${encodeURIComponent(id)}/labels/${encodeURIComponent(labelId)}`,
          'PUT',
          maybeCardSchema,
          fallback,
        ),
      detachLabel: (id: string, labelId: string, fallback: null) =>
        request(
          `/cards/${encodeURIComponent(id)}/labels/${encodeURIComponent(labelId)}`,
          'DELETE',
          maybeCardSchema,
          fallback,
        ),
      board: (projectId: string, filters: BoardFilters, fallback: Board) => {
        const query = new URLSearchParams(boardFiltersToQuery(filters)).toString();
        return request(
          `/projects/${encodeURIComponent(projectId)}/board${query ? `?${query}` : ''}`,
          'GET',
          boardSchema,
          fallback,
        );
      },
    },
    labels: {
      list: (projectId: string, fallback: Output<typeof labelsSchema>) =>
        request(`/projects/${encodeURIComponent(projectId)}/labels`, 'GET', labelsSchema, fallback),
      create: (projectId: string, input: CreateLabelInput, fallback: null) =>
        request(
          `/projects/${encodeURIComponent(projectId)}/labels`,
          'POST',
          maybeLabelSchema,
          fallback,
          input,
        ),
    },
    comments: {
      timeline: (
        cardId: string,
        page: { cursor?: string | undefined; limit?: number | undefined },
        fallback: TimelinePage,
      ) => {
        const query = new URLSearchParams();
        if (page.cursor) query.set('cursor', page.cursor);
        if (page.limit) query.set('limit', String(page.limit));
        const suffix = query.size > 0 ? `?${query}` : '';
        return request(
          `/cards/${encodeURIComponent(cardId)}/timeline${suffix}`,
          'GET',
          clientTimelinePageSchema,
          fallback,
        );
      },
      add: (cardId: string, input: CommentInput, fallback: null) =>
        request(
          `/cards/${encodeURIComponent(cardId)}/comments`,
          'POST',
          maybeCommentSchema,
          fallback,
          input,
        ),
      edit: (id: string, input: CommentInput, fallback: null) =>
        request(
          `/comments/${encodeURIComponent(id)}`,
          'PATCH',
          maybeCommentSchema,
          fallback,
          input,
        ),
      remove: (id: string, fallback: z.output<typeof deleteCommentResponseSchema>) =>
        request(
          `/comments/${encodeURIComponent(id)}`,
          'DELETE',
          deleteCommentResponseSchema,
          fallback,
        ),
    },
    bots: {
      list: (fallback: Output<typeof botsSchema>) => request('/bots', 'GET', botsSchema, fallback),
      get: (id: string, fallback: BotDetail | null) =>
        request(`/bots/${encodeURIComponent(id)}`, 'GET', maybeBotSchema, fallback),
    },
    devices: {
      list: (fallback: z.output<typeof devicesSchema>) =>
        request('/devices', 'GET', devicesSchema, fallback),
      revoke: (id: string, fallback: z.output<typeof revokeDeviceResponseSchema>) =>
        request(
          `/devices/${encodeURIComponent(id)}`,
          'DELETE',
          revokeDeviceResponseSchema,
          fallback,
        ),
    },
  };
}
