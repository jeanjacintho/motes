import { createHash, randomBytes } from 'node:crypto';
import {
  type appendEvent,
  type Db,
  type DbTransaction,
  deviceTokens,
  eq,
  pairingState,
  sql,
} from '@motes/db';
import type { newId } from '@motes/protocol';
import { Forbidden } from './errors.js';

type Services = { db: Db; clock: () => Date; newId: typeof newId; appendEvent: typeof appendEvent };
const duration = 10 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function lock(tx: DbTransaction, services: Services) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(1984020305)`);
  const inserted = await tx
    .insert(pairingState)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  if (inserted.length) await event(services, tx, 'pairing.changed', 'owner', services.clock());
  const [state] = await tx.select().from(pairingState).where(eq(pairingState.id, 1));
  if (!state) throw new Error('Pairing state missing');
  return state;
}

async function event(
  services: Services,
  tx: DbTransaction,
  type: 'pairing.changed' | 'device.paired',
  subject: string,
  now: Date,
) {
  await services.appendEvent(tx, {
    id: services.newId('event'),
    type,
    occurredAt: now.toISOString(),
    actor: { kind: 'system' },
    subject: { kind: type === 'device.paired' ? 'device' : 'pairing', id: subject },
    payload: {},
  });
}

export function createPairingCode(services: Services): Promise<string>;
export function createPairingCode(
  services: Services,
  onlyIfNoTokens: true,
): Promise<string | undefined>;
export async function createPairingCode(
  services: Services,
  onlyIfNoTokens = false,
): Promise<string | undefined> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(randomBytes(8), (byte) => alphabet[byte & 31]).join('');
  return services.db.transaction(async (tx) => {
    await lock(tx, services);
    if (
      onlyIfNoTokens &&
      (await tx.select({ id: deviceTokens.id }).from(deviceTokens).limit(1)).length
    )
      return undefined;
    const now = services.clock();
    await tx
      .update(pairingState)
      .set({ codeHash: hash(code), expiresAt: new Date(now.getTime() + duration) })
      .where(eq(pairingState.id, 1));
    await event(services, tx, 'pairing.changed', 'owner', now);
    return code;
  });
}

export async function pairDevice(services: Services, code: string, name: string): Promise<string> {
  const result = await services.db.transaction(async (tx) => {
    const state = await lock(tx, services);
    const now = services.clock();
    if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) return undefined;
    const failures =
      state.lockedUntil && state.lockedUntil.getTime() <= now.getTime() ? 0 : state.failures;
    if (
      !state.codeHash ||
      !state.expiresAt ||
      state.expiresAt.getTime() <= now.getTime() ||
      hash(code) !== state.codeHash
    ) {
      const count = failures + 1;
      await tx
        .update(pairingState)
        .set({
          failures: count >= 5 ? 0 : count,
          lockedUntil: count >= 5 ? new Date(now.getTime() + duration) : null,
        })
        .where(eq(pairingState.id, 1));
      await event(services, tx, 'pairing.changed', 'owner', now);
      return undefined;
    }
    const token = randomBytes(32).toString('base64url');
    const id = services.newId('device');
    await tx
      .insert(deviceTokens)
      .values({ id, name, kind: 'client', tokenHash: hash(token), createdAt: now });
    await tx
      .update(pairingState)
      .set({ codeHash: null, expiresAt: null, failures: 0, lockedUntil: null })
      .where(eq(pairingState.id, 1));
    await event(services, tx, 'device.paired', id, now);
    return token;
  });
  if (!result) throw new Forbidden('Invalid or unavailable pairing code');
  return result;
}
