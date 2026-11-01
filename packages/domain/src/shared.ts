import type { appendEvent, Db } from '@motes/db';
import type { EventEnvelope, KnownEvent, newId } from '@motes/protocol';
import { ValidationFailed } from './errors.js';

export type Services = {
  db: Db;
  clock: () => Date;
  newId: typeof newId;
  appendEvent: typeof appendEvent;
};
export type Actor = EventEnvelope['actor'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const owner: Actor = { kind: 'owner' };

export function parseInput<Output>(
  what: string,
  parse: () => { success: true; data: Output } | { success: false; error: { issues: unknown } },
): Output {
  const result = parse();
  if (!result.success) throw new ValidationFailed(`Invalid ${what}`, result.error.issues);
  return result.data;
}

/** Appends in the caller's transaction so the change and its event commit together. */
export function emit(
  services: Services,
  tx: Tx,
  type: KnownEvent['type'],
  subject: { kind: string; id: string },
  payload: Record<string, unknown>,
  actor: Actor,
) {
  return services.appendEvent(tx, {
    id: services.newId('event'),
    type,
    occurredAt: services.clock().toISOString(),
    actor,
    subject,
    payload,
  });
}
