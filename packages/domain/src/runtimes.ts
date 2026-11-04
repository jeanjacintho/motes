import { deviceTokens, eq, runtimes, sql } from '@motes/db';
import {
  canonicalJson,
  type RegisterRuntimeBody,
  type Runtime,
  registerRuntimeBodySchema,
  runtimeSchema,
} from '@motes/protocol';
import { Forbidden } from './errors.js';
import { emit, parseInput, type Services, type Tx } from './shared.js';

type Row = typeof runtimes.$inferSelect;

function toRuntime(row: Row): Runtime {
  return runtimeSchema.parse({
    id: row.id,
    deviceId: row.deviceId,
    machineName: row.machineName,
    os: row.os,
    engines: row.engines,
    capacity: row.capacity,
    ...(row.lastHeartbeatAt ? { lastHeartbeatAt: row.lastHeartbeatAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
  });
}

async function byDevice(tx: Tx, deviceId: string): Promise<Row | undefined> {
  const [row] = await tx
    .select()
    .from(runtimes)
    .where(eq(runtimes.deviceId, deviceId))
    .for('update');
  return row;
}

/**
 * A daemon announces its machine. There is one runtime per daemon token: the first call creates
 * it, and later calls update the same row with what the machine has now, say a newly installed
 * CLI. Registering is a sign of life, so it also counts as a heartbeat. Only a change is
 * announced, so a daemon restarting with the same engines is quiet.
 */
export async function registerRuntime(
  services: Services,
  deviceId: string,
  raw: RegisterRuntimeBody,
): Promise<Runtime> {
  const input = parseInput('runtime', () => registerRuntimeBodySchema.safeParse(raw));
  // Engines have no order of their own, so they are kept sorted and compare equal either way.
  const engines = [...input.engines].sort((a, b) => a.name.localeCompare(b.name));
  return services.db.transaction(async (tx) => {
    const [device] = await tx
      .select({ kind: deviceTokens.kind, revokedAt: deviceTokens.revokedAt })
      .from(deviceTokens)
      .where(eq(deviceTokens.id, deviceId))
      // Shared lock: a token revoked meanwhile makes this wait, then be refused, not slip through.
      .for('share');
    // The server's route guard already keeps others out; a runtime still belongs to a daemon.
    if (device?.kind !== 'daemon' || device.revokedAt)
      throw new Forbidden('Only a daemon token can register a runtime');
    const now = services.clock();
    const values = {
      machineName: input.machineName,
      os: input.os,
      engines,
      capacity: input.capacity,
    };
    let current = await byDevice(tx, deviceId);
    let row: Row | undefined;
    let type: 'runtime.registered' | 'runtime.updated' | undefined;
    if (!current) {
      [row] = await tx
        .insert(runtimes)
        .values({
          id: services.newId('runtime'),
          deviceId,
          ...values,
          lastHeartbeatAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: runtimes.deviceId })
        .returning();
      if (row) type = 'runtime.registered';
      // Two registrations of one token raced; the other one made the row.
      else current = await byDevice(tx, deviceId);
    }
    if (!row) {
      if (!current) throw new Error('Runtime row missing after registering');
      const changed =
        current.machineName !== values.machineName ||
        current.os !== values.os ||
        current.capacity !== values.capacity ||
        // jsonb does not keep key order, so engines are compared by value rather than as text.
        canonicalJson(current.engines) !== canonicalJson(values.engines);
      [row] = await tx
        .update(runtimes)
        .set({ ...values, lastHeartbeatAt: now, ...(changed ? { updatedAt: now } : {}) })
        .where(eq(runtimes.id, current.id))
        .returning();
      if (changed) type = 'runtime.updated';
    }
    if (!row) throw new Error('Runtime write returned no row');
    // The runtime speaks for itself, so it is the actor and the subject alike.
    if (type)
      await emit(
        services,
        tx,
        type,
        { kind: 'runtime', id: row.id },
        {},
        { kind: 'runtime', id: row.id },
      );
    return toRuntime(row);
  });
}

export async function listRuntimes(services: Services): Promise<Runtime[]> {
  const rows = await services.db
    .select()
    .from(runtimes)
    .orderBy(sql`lower(${runtimes.machineName}), ${runtimes.id}`);
  return rows.map(toRuntime);
}
