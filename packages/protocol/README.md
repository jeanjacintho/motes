# Protocol

## Canonical JSON and digests

`canonicalJson(value)` from `@motes/protocol` serializes JSON data with object
keys sorted recursively by UTF-16 code units, no insignificant whitespace, and
array order preserved. Numeric-looking keys are sorted as strings too. Strings
use JSON escaping and retain their whitespace and Unicode content; numbers use
JavaScript's JSON representation (including `-0` becoming `0`). Inputs are values,
not JSON source text: parse source text before passing it to these helpers.

The serializer accepts null, booleans, strings, finite numbers, dense arrays and
plain objects (including null-prototype records). It throws `TypeError` for
undefined, functions, symbols, bigints, non-finite numbers, sparse arrays,
cycles and non-plain objects such as Date, Map and Set. Object properties follow
JSON's own enumerable string-key convention; inherited, non-enumerable and
symbol-keyed properties and extra array properties are not serialized. It does
not invoke `toJSON` hooks or mutate the input. Repeated non-circular references
are allowed. This is the Motes serialization contract, not an RFC 8785 claim.

Server-side Node code imports `digest` from the Node-only subpath:

```ts
import { canonicalJson } from '@motes/protocol';
import { digest } from '@motes/protocol/node';

canonicalJson({ b: 2, a: 1 }); // '{"a":1,"b":2}'
digest({ b: 2, a: 1 }); // SHA-256 of that canonical UTF-8 JSON, lowercase hex
```

`digest(value)` applies the same validation as `canonicalJson`. The `./node`
export requires the `node` resolution condition and has no browser fallback.
The root entry point stays browser-safe and does not import `node:crypto`.
Capability normalization belongs to P2-02-01.

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

## Events

`eventEnvelopeSchema` (`EventEnvelope`) validates the shared wire envelope:
`id` is a branded event ID, `type` is nonempty, `occurredAt` is a UTC timestamp,
`actor` has a known `kind` (`owner`, `bot`, `system`, `runtime`) and an optional
nonempty `id`, `subject` has nonempty `kind` and `id`, and `payload` is required
JSON. Actor and subject IDs are generic strings because not every subject or
actor is an entity with a registered ID prefix. Envelope objects strip extra fields.

Features declare `defineEvent(type, payloadSchema)` and add the descriptor to
`eventRegistry`. A descriptor exposes its literal `type`, `payloadSchema` and
typed envelope `schema`. Server and client event unions derive from that registry;
there is no separate list of event types. `system.ping` is the first registered
event and uses an empty object payload (`{}`); extra payload fields are rejected
on the server and stripped on clients. Client object payload schemas derive from
the registered schemas with `.strip()`, preserving validation of known fields.

`parseEvent(raw)` returns a `KnownEvent` or throws a zod error for an unregistered
type, malformed envelope or invalid registered payload. Server writers must use
this parser (or `eventSchema`), rather than only validating the generic envelope.
Serialization uses ordinary `JSON.stringify`; parsing does not change IDs or time.

`parseClientEvent(raw, logger)` uses `parseWithFallback` and returns a
`ClientEvent`. An unregistered type produces `{ ...envelope, type: 'unknown',
originalType }` (`UnknownEvent`), retaining its JSON payload and original type.
Consumers can switch on `type`, ignore the unknown variant, and process the next
event. Additive fields in known payloads are stripped so a newer server does not
cause an installed client to discard a known event. Unknown actor kinds become
`'unknown'` through `tolerantEnum`. A malformed
envelope or invalid known payload is logged once and returns `null` to skip the
message. Invalid known payloads never become the unknown-type variant. Clients
can also compose `clientEventSchema` with their own fallback policy.

The registry declares contracts only; storage and delivery belong to later cards.

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
