# Protocol

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
