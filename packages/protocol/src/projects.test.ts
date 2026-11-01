import { describe, expect, test, vi } from 'vitest';
import {
  createProjectInputSchema,
  newId,
  parseClientEvent,
  parseEvent,
  projectSchema,
} from './index.js';

const project = {
  id: newId('project'),
  key: 'MOT',
  name: 'Motes',
  description: '',
  createdAt: '2026-10-31T10:00:00.000Z',
};

describe('project contracts', () => {
  test('accepts a project and keeps optional fields optional', () => {
    expect(projectSchema.parse(project)).toEqual(project);
    const full = {
      ...project,
      defaultRuntimeId: newId('runtime'),
      archivedAt: '2026-10-31T11:00:00.000Z',
    };
    expect(projectSchema.parse(full)).toEqual(full);
  });

  test.each(['M', 'mot', 'MOTESXX', 'M0T', ' MOT', 'MÖT'])('rejects the key %j', (key) => {
    expect(projectSchema.safeParse({ ...project, key }).success).toBe(false);
    expect(createProjectInputSchema.safeParse({ key, name: 'Motes' }).success).toBe(false);
  });

  test('trims names, rejects blank ones and defaults the description on creation', () => {
    expect(createProjectInputSchema.parse({ key: 'MOT', name: '  Motes  ' })).toEqual({
      key: 'MOT',
      name: 'Motes',
      description: '',
    });
    expect(createProjectInputSchema.safeParse({ key: 'MOT', name: '   ' }).success).toBe(false);
  });

  test.each([
    ['project.created', { key: 'MOT', name: 'Motes' }],
    ['project.renamed', { name: 'Motes 2' }],
    ['project.archived', {}],
  ])('registers %s', (type, payload) => {
    const raw = {
      id: newId('event'),
      type,
      occurredAt: '2026-10-31T10:00:00.000Z',
      actor: { kind: 'owner' },
      subject: { kind: 'project', id: project.id },
      payload,
    };
    expect(parseEvent(raw)).toEqual(raw);
    expect(parseClientEvent(raw, vi.fn())?.type).toBe(type);
    expect(() => parseEvent({ ...raw, payload: { ...payload, extra: 1 } })).toThrow();
  });
});
