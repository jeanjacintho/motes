import type { appendEvent, Db } from '@motes/db';
import type { newId } from '@motes/protocol';

type Services = { db: Db; clock: () => Date; newId: typeof newId; appendEvent: typeof appendEvent };

export async function emitPing(services: Services) {
  await services.db.transaction(async (tx) => {
    await services.appendEvent(tx, {
      id: services.newId('event'),
      type: 'system.ping',
      occurredAt: services.clock().toISOString(),
      actor: { kind: 'system' },
      subject: { kind: 'system', id: 'hub' },
      payload: {},
    });
  });
}
