import { withTestDb } from '@motes/db/testing';
import { authenticate, createPairingCode, pairDevice, revokeDevice } from '@motes/domain';
import { expect, it } from 'vitest';
import { createServices } from './composition.js';

const testDb = withTestDb();

it('records first and concurrent usage once and updates again at the minute boundary', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const services = { ...createServices(testDb.db), clock: () => now };
  const code = await createPairingCode(services);
  const token = await pairDevice(services, code, 'Throttle laptop');
  const results = await Promise.all(Array.from({ length: 5 }, () => authenticate(services, token)));
  const principal = results[0];
  expect(principal).toBeTruthy();
  expect(results).toEqual(Array(5).fill(principal));
  if (!principal) throw new Error('Expected paired device');
  const snapshot = async () => {
    const [device] = await testDb.db
      .$client`SELECT last_used_at FROM device_tokens WHERE id = ${principal.deviceId}`;
    const events = await testDb.db
      .$client`SELECT occurred_at FROM events WHERE type = 'device.used' AND subject_id = ${principal.deviceId} ORDER BY seq`;
    return {
      lastUsedAt: new Date(device?.last_used_at),
      events: events.map((event) => new Date(event.occurred_at)),
    };
  };
  expect(await snapshot()).toEqual({ lastUsedAt: now, events: [now] });
  now = new Date('2026-01-01T00:00:59.999Z');
  expect(await authenticate(services, token)).toEqual(principal);
  expect(await snapshot()).toEqual({
    lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
    events: [new Date('2026-01-01T00:00:00.000Z')],
  });
  now = new Date('2026-01-01T00:01:00.000Z');
  expect(await authenticate(services, token)).toEqual(principal);
  expect(await snapshot()).toEqual({
    lastUsedAt: now,
    events: [new Date('2026-01-01T00:00:00.000Z'), now],
  });
});

it('rolls back usage and revocation along with their outbox events when append fails', async () => {
  const services = createServices(testDb.db);
  const code = await createPairingCode(services);
  const token = await pairDevice(services, code, 'Rollback laptop');
  const rows = await testDb.db.$client`SELECT id FROM device_tokens WHERE name = 'Rollback laptop'`;
  const id = rows[0]?.id as string;
  expect(id).toBeTruthy();
  const failing = {
    ...services,
    appendEvent: (async (...args: Parameters<typeof services.appendEvent>) => {
      await services.appendEvent(...args);
      throw new Error('outbox failure');
    }) satisfies typeof services.appendEvent,
  };
  await expect(authenticate(failing, token)).rejects.toThrow('outbox failure');
  await expect(revokeDevice(failing, id)).rejects.toThrow('outbox failure');
  const [device] = await testDb.db
    .$client`SELECT last_used_at, revoked_at FROM device_tokens WHERE id = ${id}`;
  expect(device).toMatchObject({ last_used_at: null, revoked_at: null });
  const events = await testDb.db
    .$client`SELECT type FROM events WHERE subject_id = ${id} AND type IN ('device.used', 'device.revoked')`;
  expect(events).toHaveLength(0);
  expect(await authenticate(services, token)).toEqual({ deviceId: id, kind: 'client' });
});
