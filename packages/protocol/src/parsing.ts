import { z } from 'zod';

export type ParseLogger = (error: z.ZodError) => void;

// Clients parse with these helpers; the server parses strictly with the shared schemas.
export function parseWithFallback<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
  fallback: NoInfer<z.output<Schema>>,
  logger: ParseLogger,
): z.output<Schema> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  logger(result.error);
  return fallback;
}

/** Unknown strings degrade gracefully; malformed non-string values still fail validation. */
export function tolerantEnum<const Values extends readonly [string, ...string[]]>(values: Values) {
  return z.string().pipe(z.enum([...values, 'unknown']).catch('unknown'));
}
