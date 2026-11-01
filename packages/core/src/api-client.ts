import {
  type AddRepositoryInput,
  API_ERROR_CODES,
  apiErrorSchema,
  type CreateProjectInput,
  DEVICE_KINDS,
  deviceResponseSchema,
  healthResponseSchema,
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
  tolerantEnum,
} from '@motes/protocol';
import { z } from 'zod';
import { NetworkError } from './query-client.js';

const projectsSchema = z.array(projectSchema);
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
