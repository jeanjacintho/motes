import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId, type RegisterRuntimeBody } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { createDaemonToken } from './daemon-tokens.js';
import { revokeDevice } from './devices.js';
import { Forbidden, ValidationFailed } from './errors.js';
import { createPairingCode, pairDevice } from './pairing.js';
import { listRuntimes, registerRuntime } from './runtimes.js';

const testDb = withTestDb();
let tick = 0;
const services = () => ({
  db: testDb.db,
  appendEvent,
  clock: () => new Date(Date.parse('2026-10-31T10:00:00.000Z') + ++tick * 1000),
  newId,
});

const claude = { name: 'claude', version: '2.1.0', path: '/usr/local/bin/claude' } as const;
const codex = { name: 'codex', version: '0.9.0', path: '/usr/local/bin/codex' } as const;
const machine = (extra: Partial<RegisterRuntimeBody> = {}): RegisterRuntimeBody => ({
  machineName: 'MacBook do Jean',
  os: 'darwin 25.0',
  engines: [claude],
  capacity: 2,
  ...extra,
});

async function daemon(name = 'Máquina') {
  return createDaemonToken(services(), { name });
}
const runtimeEvents = async (id: string) => {
  const rows = await testDb.db.$client`
    SELECT type, actor FROM events WHERE subject_id = ${id} ORDER BY seq`;
  return rows.map((row) => [row.type, row.actor.kind]);
};
const count = async () =>
  Number((await testDb.db.$client`SELECT count(*)::int AS n FROM runtimes`)[0]?.n);

describe('registerRuntime', () => {
  it('creates the runtime of a daemon token and announces it once', async () => {
    const { id: deviceId } = await daemon();
    const runtime = await registerRuntime(
      services(),
      deviceId,
      machine({ engines: [claude, codex] }),
    );
    expect(runtime).toMatchObject({
      id: expect.stringMatching(/^rt_/),
      deviceId,
      machineName: 'MacBook do Jean',
      os: 'darwin 25.0',
      capacity: 2,
      lastHeartbeatAt: expect.any(String),
    });
    expect(runtime.engines.map((engine) => engine.name)).toEqual(['claude', 'codex']);
    expect(await runtimeEvents(runtime.id)).toEqual([['runtime.registered', 'runtime']]);
  });

  it('re-registering updates the engines without creating a second runtime', async () => {
    const { id: deviceId } = await daemon();
    const first = await registerRuntime(services(), deviceId, machine());
    const before = await count();
    const second = await registerRuntime(
      services(),
      deviceId,
      machine({ engines: [claude, codex], capacity: 4, machineName: 'Renomeada' }),
    );
    expect(await count()).toBe(before);
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      machineName: 'Renomeada',
      capacity: 4,
      createdAt: first.createdAt,
    });
    expect(second.engines.map((engine) => engine.name)).toEqual(['claude', 'codex']);
    expect(await runtimeEvents(first.id)).toEqual([
      ['runtime.registered', 'runtime'],
      ['runtime.updated', 'runtime'],
    ]);
  });

  it('is quiet when nothing changed, in whatever order the engines come', async () => {
    const { id: deviceId } = await daemon();
    const first = await registerRuntime(
      services(),
      deviceId,
      machine({ engines: [claude, codex] }),
    );
    const again = await registerRuntime(
      services(),
      deviceId,
      machine({ engines: [codex, claude] }),
    );
    expect(again.id).toBe(first.id);
    expect(await runtimeEvents(first.id)).toEqual([['runtime.registered', 'runtime']]);
    // It still counts as a sign of life.
    expect(Date.parse(again.lastHeartbeatAt ?? '')).toBeGreaterThan(
      Date.parse(first.lastHeartbeatAt ?? ''),
    );
  });

  it('can drop an engine that was uninstalled', async () => {
    const { id: deviceId } = await daemon();
    await registerRuntime(services(), deviceId, machine({ engines: [claude, codex] }));
    const after = await registerRuntime(services(), deviceId, machine({ engines: [codex] }));
    expect(after.engines.map((engine) => engine.name)).toEqual(['codex']);
  });

  it('gives each daemon token its own runtime', async () => {
    const [a, b] = await Promise.all([daemon('A'), daemon('B')]);
    const [one, two] = await Promise.all([
      registerRuntime(services(), a.id, machine({ machineName: 'Um' })),
      registerRuntime(services(), b.id, machine({ machineName: 'Dois' })),
    ]);
    expect(one.id).not.toBe(two.id);
    const names = (await listRuntimes(services())).map((runtime) => runtime.machineName);
    expect(names).toEqual(expect.arrayContaining(['Um', 'Dois']));
  });

  it('survives two registrations of one token at the same time', async () => {
    const { id: deviceId } = await daemon();
    const before = await count();
    const results = await Promise.all([
      registerRuntime(services(), deviceId, machine()),
      registerRuntime(services(), deviceId, machine({ capacity: 3 })),
      registerRuntime(services(), deviceId, machine({ capacity: 5 })),
    ]);
    expect(new Set(results.map((runtime) => runtime.id)).size).toBe(1);
    expect(await count()).toBe(before + 1);
    expect(
      (await runtimeEvents(results[0]?.id ?? '')).filter(([type]) => type === 'runtime.registered'),
    ).toHaveLength(1);
  });

  it('is for daemon tokens only, and not for a revoked one', async () => {
    const code = await createPairingCode(services());
    await pairDevice(services(), code, 'App');
    const [client] = await testDb.db
      .$client`SELECT id FROM device_tokens WHERE kind = 'client' LIMIT 1`;
    await expect(registerRuntime(services(), client?.id, machine())).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(registerRuntime(services(), newId('device'), machine())).rejects.toBeInstanceOf(
      Forbidden,
    );
    const { id: deviceId } = await daemon();
    await revokeDevice(services(), deviceId);
    await expect(registerRuntime(services(), deviceId, machine())).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it('refuses a token that is being revoked at that very moment, instead of letting it through', async () => {
    const { id: deviceId } = await daemon();
    let pending: Promise<unknown> = Promise.resolve();
    await testDb.db.$client.begin(async (tx) => {
      await tx`UPDATE device_tokens SET revoked_at = now() WHERE id = ${deviceId}`;
      // Registers while the revocation is not yet committed: it must wait for it, not read around it.
      pending = registerRuntime(services(), deviceId, machine()).then(
        () => 'registered',
        (error: unknown) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(await pending).toBeInstanceOf(Forbidden);
    const rows = await testDb.db.$client`SELECT id FROM runtimes WHERE device_id = ${deviceId}`;
    expect(rows).toHaveLength(0);
  });

  it.each([
    ['an empty machine name', { machineName: '  ' }],
    ['an empty os', { os: '' }],
    ['zero capacity', { capacity: 0 }],
    ['a huge capacity', { capacity: 65 }],
    ['a fractional capacity', { capacity: 1.5 }],
    ['an unknown engine', { engines: [{ ...claude, name: 'gemini' }] }],
    ['an engine twice', { engines: [claude, claude] }],
    ['an engine with no version', { engines: [{ ...claude, version: '' }] }],
  ])('refuses %s and stores nothing', async (_name, patch) => {
    const { id: deviceId } = await daemon();
    const before = await count();
    await expect(
      registerRuntime(services(), deviceId, { ...machine(), ...patch } as never),
    ).rejects.toBeInstanceOf(ValidationFailed);
    expect(await count()).toBe(before);
  });

  it('accepts a machine with no engine yet', async () => {
    const { id: deviceId } = await daemon();
    expect((await registerRuntime(services(), deviceId, machine({ engines: [] }))).engines).toEqual(
      [],
    );
  });
});
