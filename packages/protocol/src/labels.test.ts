import { describe, expect, test, vi } from 'vitest';
import {
  createLabelInputSchema,
  labelSchema,
  newId,
  parseClientEvent,
  parseEvent,
  updateLabelInputSchema,
} from './index.js';

const projectId = newId('project');

describe('labels', () => {
  test('a label has a prefixed id, a trimmed name and a lowercase hex color', () => {
    const label = { id: newId('label'), projectId, name: 'bug', color: '#d73a4a' };
    expect(labelSchema.parse(label)).toEqual(label);
    expect(newId('label')).toMatch(/^lbl_/);
    expect(createLabelInputSchema.parse({ name: ' urgent ', color: '#ff0000' }).name).toBe(
      'urgent',
    );
    for (const color of ['red', '#FF0000', '#fff', 'ff0000', '#gg0000'])
      expect(createLabelInputSchema.safeParse({ name: 'x', color }).success, color).toBe(false);
    expect(createLabelInputSchema.safeParse({ name: ' ', color: '#ff0000' }).success).toBe(false);
    expect(
      createLabelInputSchema.safeParse({ name: 'x'.repeat(41), color: '#ff0000' }).success,
    ).toBe(false);
  });

  test('an update names only what changes', () => {
    expect(updateLabelInputSchema.parse({})).toEqual({});
    expect(updateLabelInputSchema.safeParse({ color: 'blue' }).success).toBe(false);
  });

  test.each([
    ['card.labels_changed', 'card', { projectId, labelIds: [newId('label')] }],
    ['card.labels_changed', 'card', { projectId, labelIds: [] }],
    ['label.created', 'label', { projectId }],
    ['label.updated', 'label', { projectId }],
    ['label.deleted', 'label', { projectId }],
  ])('registers %s', (type, kind, payload) => {
    const raw = {
      id: newId('event'),
      type,
      occurredAt: '2026-10-31T10:00:00.000Z',
      actor: { kind: 'owner' },
      subject: { kind, id: newId(kind as 'card') },
      payload,
    };
    expect(parseEvent(raw)).toEqual(raw);
    expect(parseClientEvent(raw, vi.fn())?.type).toBe(type);
    expect(() => parseEvent({ ...raw, payload: { ...payload, extra: 1 } })).toThrow();
  });
});
