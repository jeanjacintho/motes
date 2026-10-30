import {
  type ApiErrorCode,
  apiErrorSchema,
  type ApiError as ErrorEnvelope,
  type ParseLogger,
  pairResponseSchema,
  parseWithFallback,
  timestampSchema,
  tolerantEnum,
} from '@motes/protocol';
import { z } from 'zod';

const healthSchema = z.object({
  version: z.string(),
  uptime: z.number(),
  database: z.boolean(),
  migrations: z.boolean(),
});
const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: tolerantEnum(['client', 'daemon']),
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
});
const devicesSchema = z.array(deviceSchema);
const revokeSchema = z.object({ revoked: z.boolean() });

export class ApiError extends Error {
  readonly code: ApiErrorCode;
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
    const response = await fetch(`${base}${path}`, init);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    if (!response.ok) {
      const envelope = parseWithFallback(
        apiErrorSchema,
        data,
        { code: 'internal', message: `HTTP ${response.status}`, requestId: 'unknown' },
        logger,
      );
      throw new ApiError(envelope, response.status);
    }
    return parseWithFallback(schema, data, fallback, logger);
  }
  return {
    health: (fallback: z.output<typeof healthSchema>) =>
      request('/health', 'GET', healthSchema, fallback, undefined, false),
    pair: (input: { code: string; name: string }, fallback: z.output<typeof pairResponseSchema>) =>
      request('/pair', 'POST', pairResponseSchema.strip(), fallback, input, false),
    devices: {
      list: (fallback: z.output<typeof devicesSchema>) =>
        request('/devices', 'GET', devicesSchema, fallback),
      revoke: (id: string, fallback: z.output<typeof revokeSchema>) =>
        request(`/devices/${encodeURIComponent(id)}`, 'DELETE', revokeSchema, fallback),
    },
  };
}
