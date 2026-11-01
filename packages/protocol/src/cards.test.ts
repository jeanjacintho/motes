import { describe, expect, test } from 'vitest';
import {
  CARD_PRIORITIES,
  CARD_STATUSES,
  cardRef,
  cardSchema,
  newId,
  parseCardRef,
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
    ['title', '  '],
    ['assignee', { type: 'system', id: 'x' }],
    ['createdBy', { type: 'robot', id: 'x' }],
  ])('rejects %s = %j', (field, value) => {
    expect(cardSchema.safeParse({ ...card, [field]: value }).success).toBe(false);
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
