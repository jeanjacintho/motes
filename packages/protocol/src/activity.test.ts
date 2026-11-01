import { describe, expect, test } from 'vitest';
import { ACTIVITY_EVENT_TYPES, activityEntrySchema, eventRegistry, newId } from './index.js';

describe('activity entries', () => {
  const entry = {
    id: newId('event'),
    cardId: newId('card'),
    type: 'card.status_changed',
    actor: { kind: 'owner' },
    payload: { from: 'todo', to: 'in_progress', reason: null },
    occurredAt: '2026-10-31T10:00:00.000Z',
  };

  test('parses an entry and accepts types a later epic adds', () => {
    expect(activityEntrySchema.parse(entry)).toEqual(entry);
    expect(activityEntrySchema.parse({ ...entry, type: 'run.failed' }).type).toBe('run.failed');
    expect(activityEntrySchema.safeParse({ ...entry, type: '' }).success).toBe(false);
    expect(activityEntrySchema.safeParse({ ...entry, cardId: 'x' }).success).toBe(false);
  });

  test('only lists registered events', () => {
    for (const type of ACTIVITY_EVENT_TYPES) expect(Object.hasOwn(eventRegistry, type)).toBe(true);
  });
});
