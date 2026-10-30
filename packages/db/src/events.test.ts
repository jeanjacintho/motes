import { type EventEnvelope, newId } from '@motes/protocol';
import { sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, expect, test } from 'vitest';
import { appendEvent, readEventsAfter } from './events.js';
import { withTestDb } from './testing.js';

const context = withTestDb();
const probe = pgTable('outbox_probe', { id: text().primaryKey() });
function ping(): EventEnvelope {
  return {
    id: newId('event'),
    type: 'system.ping',
    occurredAt: '2026-10-30T12:00:00.000Z',
    actor: { kind: 'system' },
    subject: { kind: 'system', id: 'hub' },
    payload: {},
  };
}

afterEach(async () => {
  await context.db.$client`DELETE FROM events`;
});

test('a domain write and its event both roll back, and both persist on commit', async () => {
  await context.db.$client`CREATE TABLE outbox_probe (id text PRIMARY KEY)`;
  const event = ping();
  await expect(
    context.db.transaction(async (tx) => {
      await tx.insert(probe).values({ id: 'rollback' });
      await appendEvent(tx, event);
      throw new Error('abort change');
    }),
  ).rejects.toThrow('abort change');
  expect(await context.db.select().from(probe)).toEqual([]);
  expect(await readEventsAfter(context.db, 0n, 200)).toEqual([]);

  const stored = await context.db.transaction(async (tx) => {
    await tx.insert(probe).values({ id: 'commit' });
    return appendEvent(tx, event);
  });
  expect(await context.db.select().from(probe)).toEqual([{ id: 'commit' }]);
  expect(await readEventsAfter(context.db, 0n, 200)).toEqual([{ seq: stored.seq, event }]);
});

test('reads only events strictly after the cursor in seq order, honoring the limit', async () => {
  const events = [ping(), ping(), ping()];
  const stored = [];
  for (const event of events) {
    stored.push(await context.db.transaction((tx) => appendEvent(tx, event)));
  }
  const [first, second, third] = stored;
  if (!first || !second || !third) throw new Error('Expected three persisted events');
  expect(await readEventsAfter(context.db, first.seq, 200)).toEqual([second, third]);
  expect(await readEventsAfter(context.db, first.seq, 1)).toEqual([second]);
  expect(await readEventsAfter(context.db, third.seq, 200)).toEqual([]);
});

test('rejects unknown types, invalid payloads and duplicate event identities', async () => {
  const event = ping();
  for (const invalid of [
    { ...event, type: 'unregistered.event' },
    { ...event, payload: { unexpected: true } },
    { ...event, actor: { kind: 'stranger' } },
  ]) {
    await expect(context.db.transaction((tx) => appendEvent(tx, invalid))).rejects.toThrow();
  }
  expect(await readEventsAfter(context.db, 0n, 200)).toEqual([]);
  await context.db.transaction((tx) => appendEvent(tx, event));
  await expect(context.db.transaction((tx) => appendEvent(tx, event))).rejects.toThrow();
  expect(await readEventsAfter(context.db, 0n, 200)).toHaveLength(1);
});

test('preserves bigint cursor precision beyond the safe integer range', async () => {
  await context.db.execute(
    sql`SELECT setval(pg_get_serial_sequence('events', 'seq'), 9007199254740992)`,
  );
  const stored = await context.db.transaction((tx) => appendEvent(tx, ping()));
  expect(stored.seq).toBe(9007199254740993n);
  expect(await readEventsAfter(context.db, stored.seq - 1n, 1)).toEqual([stored]);
  expect(await readEventsAfter(context.db, stored.seq, 1)).toEqual([]);
});

test('rejects invalid cursors and unbounded page sizes', async () => {
  await expect(readEventsAfter(context.db, -1n, 1)).rejects.toThrow();
  await expect(readEventsAfter(context.db, 9223372036854775808n, 1)).rejects.toThrow();
  for (const limit of [0, -1, 201, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expect(readEventsAfter(context.db, 0n, limit)).rejects.toThrow();
  }
});

test('a concurrent writer cannot publish past an uncommitted lower seq', async () => {
  const first = await context.db.transaction(async (tx) => {
    const pending = await appendEvent(tx, ping());
    expect(await readEventsAfter(context.db, 0n, 200)).toEqual([]);
    await expect(
      context.db.transaction(async (other) => {
        await other.execute(sql`SET LOCAL lock_timeout = '100ms'`);
        return appendEvent(other, ping());
      }),
    ).rejects.toThrow();
    return pending;
  });
  const second = await context.db.transaction((tx) => appendEvent(tx, ping()));
  expect(second.seq).toBeGreaterThan(first.seq);
  expect(await readEventsAfter(context.db, 0n, 200)).toEqual([first, second]);
});

test('NOTIFY wakes listeners after commit and stays silent after rollback', async () => {
  const received: string[] = [];
  const listener = await context.db.$client.listen('motes_events', (payload) => {
    received.push(payload);
  });
  let barrier = Promise.withResolvers<void>();
  // A second channel on the same listener connection provides a deterministic
  // delivery barrier, including when the transaction should emit nothing.
  const marker = await context.db.$client.listen('outbox_test_barrier', () => barrier.resolve());
  async function drain() {
    await context.db.$client`SELECT pg_notify('outbox_test_barrier', '')`;
    await barrier.promise;
    barrier = Promise.withResolvers<void>();
  }
  try {
    await expect(
      context.db.transaction(async (tx) => {
        await appendEvent(tx, ping());
        await drain();
        expect(received).toEqual([]);
        throw new Error('rollback notification');
      }),
    ).rejects.toThrow('rollback notification');
    await drain();
    expect(received).toEqual([]);

    const committed = await context.db.transaction(async (tx) => {
      const event = await appendEvent(tx, ping());
      await drain();
      expect(received).toEqual([]);
      return event;
    });
    await drain();
    expect(received).toEqual([committed.seq.toString()]);
    expect(await readEventsAfter(context.db, 0n, 200)).toEqual([committed]);
  } finally {
    await marker.unlisten();
    await listener.unlisten();
  }
});
