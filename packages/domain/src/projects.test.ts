import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { Conflict, NotFound, ValidationFailed } from './errors.js';
import { archiveProject, createProject, listProjects, renameProject } from './projects.js';

const testDb = withTestDb();

function services(overrides: Partial<Parameters<typeof createProject>[0]> = {}) {
  return {
    db: testDb.db,
    appendEvent,
    clock: () => new Date('2026-10-31T10:00:00.000Z'),
    newId,
    ...overrides,
  };
}

async function projectEvents(subjectId: string) {
  const rows = await testDb.db.$client`
    SELECT type, actor, payload FROM events WHERE subject_id = ${subjectId} ORDER BY seq`;
  return rows.map((row) => ({ type: row.type, actor: row.actor, payload: row.payload }));
}

describe('projects', () => {
  it('creates a project and emits project.created in the same transaction', async () => {
    const project = await createProject(services(), { key: 'AAA', name: ' Alpha ' });
    expect(project).toMatchObject({
      key: 'AAA',
      name: 'Alpha',
      description: '',
      createdAt: '2026-10-31T10:00:00.000Z',
    });
    expect(project.archivedAt).toBeUndefined();
    expect(await projectEvents(project.id)).toEqual([
      { type: 'project.created', actor: { kind: 'owner' }, payload: { key: 'AAA', name: 'Alpha' } },
    ]);
  });

  it('rolls the project back when its event cannot be stored', async () => {
    const failing = services({
      appendEvent: async () => {
        throw new Error('outbox unavailable');
      },
    });
    await expect(createProject(failing, { key: 'ROLL', name: 'Rollback' })).rejects.toThrow(
      'outbox unavailable',
    );
    expect(await listProjects(services(), { includeArchived: true })).not.toContainEqual(
      expect.objectContaining({ key: 'ROLL' }),
    );
  });

  it('rejects a duplicate key with Conflict and emits nothing for the attempt', async () => {
    const first = await createProject(services(), { key: 'DUP', name: 'First' });
    await expect(createProject(services(), { key: 'DUP', name: 'Second' })).rejects.toBeInstanceOf(
      Conflict,
    );
    const rows = await testDb.db.$client`
      SELECT count(*)::int AS count FROM events WHERE type = 'project.created' AND payload->>'key' = 'DUP'`;
    expect(rows[0]?.count).toBe(1);
    await archiveProject(services(), first.id);
    await expect(createProject(services(), { key: 'DUP', name: 'Third' })).rejects.toBeInstanceOf(
      Conflict,
    );
  });

  it('rejects malformed input as ValidationFailed', async () => {
    await expect(createProject(services(), { key: 'x', name: 'Bad' })).rejects.toBeInstanceOf(
      ValidationFailed,
    );
    await expect(createProject(services(), { key: 'BAD', name: '  ' })).rejects.toBeInstanceOf(
      ValidationFailed,
    );
  });

  it('hides archived projects unless asked and archives idempotently', async () => {
    const live = await createProject(services(), { key: 'LIV', name: 'Live' });
    const old = await createProject(services(), { key: 'OLD', name: 'Old' });
    const archived = await archiveProject(services(), old.id);
    expect(archived.archivedAt).toBe('2026-10-31T10:00:00.000Z');
    expect((await listProjects(services())).map((project) => project.id)).toContain(live.id);
    expect((await listProjects(services())).map((project) => project.id)).not.toContain(old.id);
    expect(
      (await listProjects(services(), { includeArchived: true })).map((project) => project.id),
    ).toContain(old.id);
    await archiveProject(services(), old.id);
    expect((await projectEvents(old.id)).map((event) => event.type)).toEqual([
      'project.created',
      'project.archived',
    ]);
  });

  it('renames a project, skips no-op renames and reports unknown ids', async () => {
    const project = await createProject(services(), { key: 'REN', name: 'Before' });
    expect((await renameProject(services(), project.id, 'After')).name).toBe('After');
    await renameProject(services(), project.id, 'After');
    expect((await projectEvents(project.id)).map((event) => event.type)).toEqual([
      'project.created',
      'project.renamed',
    ]);
    await expect(renameProject(services(), project.id, ' ')).rejects.toBeInstanceOf(
      ValidationFailed,
    );
    await expect(renameProject(services(), newId('project'), 'Nope')).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(archiveProject(services(), newId('project'))).rejects.toBeInstanceOf(NotFound);
  });

  it('lists projects in creation order and records the acting bot', async () => {
    const bot = { kind: 'bot', id: newId('bot') } as const;
    const first = await createProject(services(), { key: 'ORA', name: 'One' }, bot);
    const second = await createProject(
      services({ clock: () => new Date('2026-10-31T11:00:00.000Z') }),
      { key: 'ORB', name: 'Two' },
    );
    const ids = (await listProjects(services())).map((project) => project.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    expect((await projectEvents(first.id))[0]?.actor).toEqual(bot);
  });
});
