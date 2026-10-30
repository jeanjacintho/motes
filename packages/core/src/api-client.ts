import {
  API_ERROR_CODES,
  apiErrorSchema,
  DEVICE_KINDS,
  deviceResponseSchema,
  healthResponseSchema,
  type ParseLogger,
  pairResponseSchema,
  parseWithFallback,
  revokeDeviceResponseSchema,
  tolerantEnum,
} from '@motes/protocol';
import { z } from 'zod';

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
    const response = await fetch(`${base}${path}`, init);
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
