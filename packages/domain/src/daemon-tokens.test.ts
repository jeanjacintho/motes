import { createHash } from 'node:crypto';
import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { createDaemonToken } from './daemon-tokens.js';
import { authenticate, listDevices, revokeDevice } from './devices.js';
import { ValidationFailed } from './errors.js';

const testDb = withTestDb();
const services = () => ({
  db: testDb.db,
  appendEvent,
  clock: () => new Date('2026-10-31T10:00:00.000Z'),
  newId,
});

describe('createDaemonToken', () => {
  it('mints a daemon device token that authenticates as a daemon', async () => {
    const minted = await createDaemonToken(services(), { name: '  MacBook do Jean  ' });
    expect(minted).toMatchObject({ name: 'MacBook do Jean', id: expect.stringMatching(/^dev_/) });
    expect(minted.token.length).toBeGreaterThanOrEqual(43);
    expect(await authenticate(services(), minted.token)).toEqual({
      deviceId: minted.id,
      kind: 'daemon',
    });
  });

  it('stores only the hash, so the token cannot be read back', async () => {
    const minted = await createDaemonToken(services(), { name: 'Servidor' });
    const [row] = await testDb.db.$client`
      SELECT token_hash, kind, name FROM device_tokens WHERE id = ${minted.id}`;
    expect(row).toMatchObject({
      kind: 'daemon',
      name: 'Servidor',
      token_hash: createHash('sha256').update(minted.token).digest('hex'),
    });
    const anything = await testDb.db.$client`
      SELECT id FROM device_tokens WHERE token_hash = ${minted.token}`;
    expect(anything).toHaveLength(0);
  });

  it('gives every call a different token', async () => {
    const [a, b] = await Promise.all([
      createDaemonToken(services(), { name: 'A' }),
      createDaemonToken(services(), { name: 'B' }),
    ]);
    expect(a.token).not.toBe(b.token);
    expect(a.id).not.toBe(b.id);
  });

  it('shows in the device list as a daemon and can be revoked like any device', async () => {
    const minted = await createDaemonToken(services(), { name: 'Revogável' });
    const listed = (await listDevices(services())).find((device) => device.id === minted.id);
    expect(listed).toMatchObject({ name: 'Revogável', kind: 'daemon', revokedAt: null });
    await revokeDevice(services(), minted.id);
    expect(await authenticate(services(), minted.token)).toBeNull();
  });

  it('announces the new device with one event', async () => {
    const minted = await createDaemonToken(services(), { name: 'Evento' });
    const events = await testDb.db.$client`
      SELECT type, actor FROM events WHERE subject_id = ${minted.id}`;
    expect(events.map((event) => [event.type, event.actor.kind])).toEqual([
      ['device.paired', 'owner'],
    ]);
  });

  it.each(['', '   ', 'x'.repeat(81)])('refuses the name %j and stores nothing', async (name) => {
    const before = (await listDevices(services())).length;
    await expect(createDaemonToken(services(), { name })).rejects.toBeInstanceOf(ValidationFailed);
    expect((await listDevices(services())).length).toBe(before);
  });
});
