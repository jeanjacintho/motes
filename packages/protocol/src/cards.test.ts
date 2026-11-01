import { describe, expect, test, vi } from 'vitest';
import {
  assignCardInputSchema,
  CARD_PRIORITIES,
  CARD_STATUSES,
  cardRef,
  cardSchema,
  createCardInputSchema,
  MAX_CARD_NUMBER,
  newId,
  parseCardRef,
  parseClientEvent,
  parseEvent,
  updateCardInputSchema,
} from './index.js';

const card = {
  id: newId('card'),
  projectId: newId('project'),
  number: 12,
  title: 'Corrigir typo no README',
  description: '',
  status: 'backlog',
  priority: 'none',
  labels: [],
  createdBy: { type: 'owner', id: 'owner' },
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

describe('card contracts', () => {
  test('accepts a card and its optional assignee and repository', () => {
    expect(cardSchema.parse(card)).toEqual(card);
    const full = {
      ...card,
      assignee: { type: 'bot', id: newId('bot') },
      repositoryId: newId('repository'),
      labels: ['bug'],
    };
    expect(cardSchema.parse(full)).toEqual(full);
  });

  test('lists the workflow statuses and priorities from the design', () => {
    expect(CARD_STATUSES).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'done',
      'blocked',
      'cancelled',
    ]);
    expect(CARD_PRIORITIES).toEqual(['none', 'low', 'medium', 'high', 'urgent']);
  });

  test.each([
    ['status', 'started'],
    ['priority', 'critical'],
    ['number', 0],
    ['number', 1.5],
    ['number', 2_147_483_648],
    ['title', '  '],
    ['assignee', { type: 'system', id: 'x' }],
    ['createdBy', { type: 'robot', id: 'x' }],
  ])('rejects %s = %j', (field, value) => {
    expect(cardSchema.safeParse({ ...card, [field]: value }).success).toBe(false);
  });

  test('limits card numbers to what the database column can store', () => {
    expect(MAX_CARD_NUMBER).toBe(2_147_483_647);
    expect(cardSchema.safeParse({ ...card, number: MAX_CARD_NUMBER }).success).toBe(true);
    expect(parseCardRef('MOT-2147483647')).toEqual({ key: 'MOT', number: 2_147_483_647 });
    expect(parseCardRef('MOT-2147483648')).toBeNull();
    expect(parseCardRef('MOT-99999999999999999999')).toBeNull();
  });

  test('formats and parses KEY-number references', () => {
    expect(cardRef('MOT', 12)).toBe('MOT-12');
    expect(parseCardRef('MOT-12')).toEqual({ key: 'MOT', number: 12 });
    expect(parseCardRef('AB-1')).toEqual({ key: 'AB', number: 1 });
    for (const bad of [
      'mot-12',
      'MOT-0',
      'MOT-012',
      'MOT12',
      'M-1',
      'MOTESXX-1',
      'MOT-',
      '-1',
      'MOT-1-2',
    ])
      expect(parseCardRef(bad), bad).toBeNull();
  });
});

describe('card events', () => {
  const projectId = card.projectId;
  test.each([
    ['card.created', { projectId, number: 12 }],
    ['card.updated', { projectId, changed: ['title', 'priority'] }],
    ['card.assigned', { projectId, assignee: { type: 'bot', id: 'bot_1' } }],
    ['card.assigned', { projectId, assignee: null }],
    ['card.deleted', { projectId }],
  ])('registers %s', (type, payload) => {
    const raw = {
      id: newId('event'),
      type,
      occurredAt: '2026-10-31T10:00:00.000Z',
      actor: { kind: 'owner' },
      subject: { kind: 'card', id: card.id },
      payload,
    };
    expect(parseEvent(raw)).toEqual(raw);
    expect(parseClientEvent(raw, vi.fn())?.type).toBe(type);
    expect(() => parseEvent({ ...raw, payload: { ...payload, extra: 1 } })).toThrow();
  });

  test('card.updated needs at least one changed field and only editable ones', () => {
    const raw = (changed: string[]) => ({
      id: newId('event'),
      type: 'card.updated',
      occurredAt: '2026-10-31T10:00:00.000Z',
      actor: { kind: 'owner' },
      subject: { kind: 'card', id: card.id },
      payload: { projectId: card.projectId, changed },
    });
    expect(() => parseEvent(raw([]))).toThrow();
    expect(() => parseEvent(raw(['status']))).toThrow();
  });
});

describe('card inputs', () => {
  test('creation defaults the description and priority and trims the title', () => {
    expect(createCardInputSchema.parse({ title: '  Corrigir  ' })).toEqual({
      title: 'Corrigir',
      description: '',
      priority: 'none',
    });
    expect(createCardInputSchema.safeParse({ title: ' ' }).success).toBe(false);
    expect(createCardInputSchema.safeParse({ title: 'x', priority: 'critical' }).success).toBe(
      false,
    );
  });

  test('an update changes only the fields it names and cannot touch status or assignee', () => {
    expect(updateCardInputSchema.parse({})).toEqual({});
    expect(updateCardInputSchema.parse({ priority: 'high', status: 'done' })).toEqual({
      priority: 'high',
    });
    expect(updateCardInputSchema.safeParse({ title: '' }).success).toBe(false);
  });

  test('assignment takes a principal or null', () => {
    expect(assignCardInputSchema.parse(null)).toBeNull();
    expect(assignCardInputSchema.parse({ type: 'bot', id: 'bot_1' })).toEqual({
      type: 'bot',
      id: 'bot_1',
    });
    expect(assignCardInputSchema.safeParse({ type: 'robot', id: 'x' }).success).toBe(false);
  });
});
