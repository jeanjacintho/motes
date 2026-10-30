import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

/** Node-only: SHA-256 of the UTF-8 canonical JSON, encoded as lowercase hexadecimal. */
export function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
