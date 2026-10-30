# Protocol

## Base schemas

The package exports shared zod schemas and their TypeScript types:

- `timestampSchema` (`Timestamp`): ISO 8601 UTC strings with a `Z` suffix,
  including fractional seconds. Offsets (even `+00:00`), local times and invalid
  calendar dates are rejected; strings are preserved without normalization.
- `pageRequestSchema` (`PageRequest`): a required integer `limit` from 1 through
  200, plus an optional nonempty opaque `cursor`. There is no implicit limit.
- `pageSchema(item)` (`Page<Item>`): validates each entry in `items` against
  the supplied schema. `nextCursor` is required: a nonempty opaque string for
  continuation, or `null` when exhausted (including an empty result).
- `apiErrorSchema` (`ApiError`): a flat envelope with a stable `code`, nonempty
  `message` and nonempty `requestId`; optional `details` accepts JSON values.
  `API_ERROR_CODES` is the single list of allowed codes (`ApiErrorCode`).
- `usageSchema` (`Usage`): required nonnegative safe integers `inputTokens`,
  `outputTokens`, `cachedTokens`, `turns` and `durationMs`. `estimatedUsd` is an
  optional finite nonnegative number, including fractional dollars. Omission
  stays omission; only include an estimate when the CLI reports one. Billing
  remains the owner's subscriptions. Token counts are independent reported
  counters; no relationship between cached and input tokens is assumed.

These schemas validate values without coercing strings to numbers. Objects
strip unknown fields using zod's default behavior.

## Client parsing

Clients parse with `parseWithFallback` and `tolerantEnum`; the server parses
strictly with the shared schemas. Extend an enum field for client consumption
without changing the server's allowed values:

```ts
import { API_ERROR_CODES, apiErrorSchema, parseWithFallback, tolerantEnum } from '@motes/protocol';

const clientErrorSchema = apiErrorSchema.extend({ code: tolerantEnum(API_ERROR_CODES) });
const error = parseWithFallback(
  clientErrorSchema,
  response,
  { code: 'unknown', message: 'Unavailable', requestId: 'unknown' },
  (error) => logger.warn(error.issues),
);
```

`parseWithFallback(schema, data, fallback, logger)` returns the parsed output,
including schema defaults, transforms and unknown-field stripping. On validation
failure it calls the injected `ParseLogger` once with the zod error, then returns
the supplied fallback unchanged. The fallback must match the schema's output
type; it is not parsed again. The fourth argument is required so callers provide
their logging policy without global state or built-in I/O in protocol. Use a
logger that does not throw; schema transform exceptions and logger exceptions
propagate rather than being treated as invalid responses.

`tolerantEnum(values)` accepts a nonempty readonly tuple of known string values.
It preserves known values and maps every other string to `'unknown'`. Non-string
inputs still fail validation, allowing `parseWithFallback` to report malformed
responses. Its inferred output type includes the known literals and `'unknown'`.

## Entity IDs

Entity IDs are exported from `@motes/protocol`:

```ts
import { type CardId, idSchema, newId } from '@motes/protocol';

const id: CardId = newId('card');
const parsed: CardId = idSchema('card').parse(input);
```

`ID_PREFIXES` is the single registry of entity kinds and their prefixes. Add new
entities there as their cards land. Each ID has its prefix followed by a canonical
26-character uppercase Crockford base32 body: 48 bits of Unix milliseconds and
80 bits from Web Crypto. The first body character is restricted to `0`–`7` to
prevent timestamp overflow. Parsing rejects other prefixes, noncanonical
characters, whitespace, and invalid lengths without normalizing the input.

IDs of the same entity kind sort lexicographically by their generation timestamp.
IDs generated in the same millisecond have random order; generation does not
compensate for a clock moving backwards. Different entity kinds sort by prefix.
Each kind has a separate TypeScript brand; validate external strings before using
them as IDs. IDs are identifiers, not authorization tokens.

Generation uses the platform clock and Web Crypto in Node 24 and browsers, with
no Node-only runtime imports. Domain code must receive its ID generator through
Services when the composition root is introduced (P0-04-03).
