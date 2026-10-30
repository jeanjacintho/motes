import { createHash } from 'node:crypto';
import { type appendEvent, type Db, deviceTokens, eq, sql } from '@motes/db';
import type { newId } from '@motes/protocol';
import { NotFound } from './errors.js';

type Services = { db: Db; clock: () => Date; newId: typeof newId; appendEvent: typeof appendEvent };

export async function authenticate(services: Services, token: string) {
  const hash = createHash('sha256').update(token).digest('hex');
  const now = services.clock();
  return services.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.tokenHash, hash))
      .for('update');
    const device = rows[0];
    if (!device || device.revokedAt) return null;
    if (!device.lastUsedAt || now.getTime() - device.lastUsedAt.getTime() >= 60_000) {
      await tx.update(deviceTokens).set({ lastUsedAt: now }).where(eq(deviceTokens.id, device.id));
      await services.appendEvent(tx, {
        id: services.newId('event'),
        type: 'device.used',
        occurredAt: now.toISOString(),
        actor: { kind: 'system' },
        subject: { kind: 'device', id: device.id },
        payload: {},
      });
    }
    return { deviceId: device.id, kind: device.kind };
  });
}

export async function listDevices(services: Services) {
  const rows = await services.db
    .select({
      id: deviceTokens.id,
      name: deviceTokens.name,
      kind: deviceTokens.kind,
      createdAt: deviceTokens.createdAt,
      lastUsedAt: deviceTokens.lastUsedAt,
      revokedAt: deviceTokens.revokedAt,
    })
    .from(deviceTokens);
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }));
}

export async function revokeDevice(services: Services, id: string) {
  await services.db.transaction(async (tx) => {
    const now = services.clock();
    const rows = await tx
      .update(deviceTokens)
      .set({ revokedAt: now })
      .where(sql`${deviceTokens.id} = ${id} AND ${deviceTokens.revokedAt} IS NULL`)
      .returning();
    if (!rows.length) throw new NotFound('Device not found');
    await services.appendEvent(tx, {
      id: services.newId('event'),
      type: 'device.revoked',
      occurredAt: now.toISOString(),
      actor: { kind: 'owner' },
      subject: { kind: 'device', id },
      payload: {},
    });
  });
}
