import { createHash, randomBytes } from 'node:crypto';
import { deviceTokens } from '@motes/db';
import { type CreateRuntimeTokenBody, createRuntimeTokenBodySchema } from '@motes/protocol';
import { emit, parseInput, type Services } from './shared.js';

/**
 * Mints a token for a daemon. It is a device token of its own kind, so it can be listed and
 * revoked like any other, but the server lets it reach only the daemon routes. The token itself
 * is returned here and never stored: only its hash is, so it can be shown once and no more.
 */
export async function createDaemonToken(
  services: Services,
  input: CreateRuntimeTokenBody,
): Promise<{ id: string; name: string; token: string }> {
  const { name } = parseInput('runtime token', () => createRuntimeTokenBodySchema.safeParse(input));
  const token = randomBytes(32).toString('base64url');
  const id = services.newId('device');
  await services.db.transaction(async (tx) => {
    await tx.insert(deviceTokens).values({
      id,
      name,
      kind: 'daemon',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      createdAt: services.clock(),
    });
    await emit(services, tx, 'device.paired', { kind: 'device', id }, {}, { kind: 'owner' });
  });
  return { id, name, token };
}
