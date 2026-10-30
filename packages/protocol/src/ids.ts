import { z } from 'zod';

export const ID_PREFIXES = Object.freeze({
  project: 'prj_',
  card: 'card_',
  bot: 'bot_',
  run: 'run_',
  runtime: 'rt_',
  message: 'msg_',
  event: 'evt_',
} as const);

export type IdKind = keyof typeof ID_PREFIXES;
export type Id<Kind extends IdKind> = string & z.core.$brand<Kind>;

// Canonical Crockford base32: 48 timestamp bits followed by 80 random bits.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BODY_PATTERN = '[0-7][0-9A-HJKMNP-TV-Z]{25}';

export function idSchema<Kind extends IdKind>(kind: Kind): z.ZodType<Id<Kind>, string> {
  return z
    .string()
    .length(ID_PREFIXES[kind].length + 26)
    .regex(new RegExp(`^${ID_PREFIXES[kind]}${BODY_PATTERN}$`))
    .transform((value) => value as Id<Kind>);
}

export type ProjectId = Id<'project'>;
export type CardId = Id<'card'>;
export type BotId = Id<'bot'>;
export type RunId = Id<'run'>;
export type RuntimeId = Id<'runtime'>;
export type MessageId = Id<'message'>;
export type EventId = Id<'event'>;

/** Sortable across milliseconds within one entity kind; same-millisecond order is random. */
export function newId<Kind extends IdKind>(kind: Kind): Id<Kind> {
  let timestamp = Date.now();
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp >= 2 ** 48) {
    throw new RangeError('ID timestamp must be an unsigned 48-bit integer');
  }

  let body = '';
  for (let index = 0; index < 10; index++) {
    body = ALPHABET.charAt(timestamp % 32) + body;
    timestamp = Math.floor(timestamp / 32);
  }

  // Web Crypto is available in Node 24 and browsers, without a Node-only runtime import.
  for (const byte of globalThis.crypto.getRandomValues(new Uint8Array(16))) {
    body += ALPHABET.charAt(byte & 31);
  }
  return idSchema(kind).parse(ID_PREFIXES[kind] + body);
}
