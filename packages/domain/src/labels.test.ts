import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { createCard } from './cards.js';
import { Conflict, NotFound, ValidationFailed } from './errors.js';
import {
  attachLabel,
  createLabel,
  deleteLabel,
  detachLabel,
  listLabels,
  updateLabel,
} from './labels.js';
import { createProject } from './projects.js';
import { changeStatus } from './status.js';

const testDb = withTestDb();

function services(overrides: Record<string, unknown> = {}) {
  return {
    db: testDb.db,
    appendEvent,
    clock: () => new Date('2026-10-31T10:00:00.000Z'),
    newId,
    botExists: async () => true,
    ...overrides,
  };
}

let counter = 0;
async function newProject() {
  const key = `L${String.fromCharCode(65 + (counter % 26))}${String.fromCharCode(65 + Math.floor(counter / 26))}`;
  counter++;
  return createProject(services(), { key, name: key });
}

async function events(subjectId: string) {
  const rows = await testDb.db.$client`
    SELECT type, payload FROM events WHERE subject_id = ${subjectId} ORDER BY seq`;
  return rows.map((row) => ({ type: row.type, payload: row.payload }));
}

const red = '#d73a4a';

describe('label management', () => {
  it('creates, lists in name order, renames, recolors and emits one event each', async () => {
    const project = await newProject();
    const zeta = await createLabel(services(), project.id, { name: 'zeta', color: red });
    const alpha = await createLabel(services(), project.id, { name: 'Alpha', color: red });
    expect((await listLabels(services(), project.id)).map((label) => label.name)).toEqual([
      'Alpha',
      'zeta',
    ]);
    const renamed = await updateLabel(services(), zeta.id, { name: 'beta', color: '#000000' });
    expect(renamed).toMatchObject({ name: 'beta', color: '#000000' });
    expect(await events(zeta.id)).toEqual([
      { type: 'label.created', payload: { projectId: project.id } },
      { type: 'label.updated', payload: { projectId: project.id } },
    ]);
    expect(await updateLabel(services(), alpha.id, { name: 'Alpha' })).toEqual(alpha);
    expect(await updateLabel(services(), alpha.id, { name: 'ALPHA' })).toMatchObject({
      name: 'ALPHA',
    });
    expect(await events(alpha.id)).toHaveLength(2);
  });

  it('keeps names unique per project ignoring case, but not across projects', async () => {
    const project = await newProject();
    const other = await newProject();
    const bug = await createLabel(services(), project.id, { name: 'bug', color: red });
    await expect(
      createLabel(services(), project.id, { name: 'BUG', color: red }),
    ).rejects.toBeInstanceOf(Conflict);
    await createLabel(services(), other.id, { name: 'bug', color: red });
    const other2 = await createLabel(services(), project.id, { name: 'urgent', color: red });
    await expect(updateLabel(services(), other2.id, { name: 'Bug' })).rejects.toBeInstanceOf(
      Conflict,
    );
    expect(bug.name).toBe('bug');
    expect(await events(other2.id)).toHaveLength(1);
  });

  it('reports unknown projects and labels and malformed input', async () => {
    const project = await newProject();
    await expect(
      createLabel(services(), newId('project'), { name: 'x', color: red }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      createLabel(services(), project.id, { name: 'x', color: 'red' }),
    ).rejects.toBeInstanceOf(ValidationFailed);
    await expect(updateLabel(services(), newId('label'), { name: 'x' })).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(deleteLabel(services(), newId('label'))).rejects.toBeInstanceOf(NotFound);
  });
});

describe('attaching labels', () => {
  it('attaches and detaches with one card.labels_changed each, idempotently', async () => {
    const project = await newProject();
    const card = await createCard(services(), project.id, { title: 'x' });
    const bug = await createLabel(services(), project.id, { name: 'bug', color: red });
    const customer = await createLabel(services(), project.id, { name: 'customer', color: red });
    expect((await attachLabel(services(), card.id, customer.id)).labels).toEqual([customer.id]);
    expect((await attachLabel(services(), card.id, bug.id)).labels).toEqual([bug.id, customer.id]);
    await attachLabel(services(), card.id, bug.id);
    expect((await detachLabel(services(), card.id, customer.id)).labels).toEqual([bug.id]);
    await detachLabel(services(), card.id, customer.id);
    expect((await events(card.id)).slice(1)).toEqual([
      { type: 'card.labels_changed', payload: { projectId: project.id, labelIds: [customer.id] } },
      {
        type: 'card.labels_changed',
        payload: { projectId: project.id, labelIds: [bug.id, customer.id] },
      },
      { type: 'card.labels_changed', payload: { projectId: project.id, labelIds: [bug.id] } },
    ]);
  });

  it('refuses unknown cards and labels and labels of another project', async () => {
    const project = await newProject();
    const other = await newProject();
    const card = await createCard(services(), project.id, { title: 'x' });
    const foreign = await createLabel(services(), other.id, { name: 'bug', color: red });
    await expect(attachLabel(services(), card.id, foreign.id)).rejects.toBeInstanceOf(
      ValidationFailed,
    );
    await expect(attachLabel(services(), card.id, newId('label'))).rejects.toBeInstanceOf(NotFound);
    await expect(attachLabel(services(), newId('card'), foreign.id)).rejects.toBeInstanceOf(
      NotFound,
    );
    expect(await events(card.id)).toHaveLength(1);
  });

  it('shows labels on cards returned by the other card operations', async () => {
    const project = await newProject();
    const card = await createCard(services(), project.id, { title: 'x' });
    const bug = await createLabel(services(), project.id, { name: 'bug', color: red });
    await attachLabel(services(), card.id, bug.id);
    expect((await changeStatus(services(), card.id, 'todo')).labels).toEqual([bug.id]);
  });
});

describe('deleting a label', () => {
  it('removes it from all cards atomically and announces each card and the label', async () => {
    const project = await newProject();
    const bug = await createLabel(services(), project.id, { name: 'bug', color: red });
    const keep = await createLabel(services(), project.id, { name: 'keep', color: red });
    const cardIds: string[] = [];
    for (let index = 0; index < 5; index++) {
      const card = await createCard(services(), project.id, { title: `c${index}` });
      await attachLabel(services(), card.id, bug.id);
      if (index === 0) await attachLabel(services(), card.id, keep.id);
      cardIds.push(card.id);
    }
    await deleteLabel(services(), bug.id);
    const links = await testDb.db
      .$client`SELECT card_id FROM card_labels WHERE label_id = ${bug.id}`;
    expect(links).toHaveLength(0);
    expect(await testDb.db.$client`SELECT id FROM labels WHERE id = ${bug.id}`).toHaveLength(0);
    const first = await events(cardIds[0] as string);
    expect(first.at(-1)).toEqual({
      type: 'card.labels_changed',
      payload: { projectId: project.id, labelIds: [keep.id] },
    });
    for (const id of cardIds.slice(1))
      expect((await events(id)).at(-1)?.payload).toEqual({ projectId: project.id, labelIds: [] });
    expect((await events(bug.id)).at(-1)?.type).toBe('label.deleted');
  });

  it('leaves everything in place when the outbox fails', async () => {
    const project = await newProject();
    const bug = await createLabel(services(), project.id, { name: 'bug', color: red });
    const card = await createCard(services(), project.id, { title: 'x' });
    await attachLabel(services(), card.id, bug.id);
    const failing = services({
      appendEvent: async () => {
        throw new Error('outbox down');
      },
    });
    await expect(deleteLabel(failing, bug.id)).rejects.toThrow('outbox down');
    expect(
      await testDb.db.$client`SELECT 1 FROM card_labels WHERE label_id = ${bug.id}`,
    ).toHaveLength(1);
    expect(await testDb.db.$client`SELECT 1 FROM labels WHERE id = ${bug.id}`).toHaveLength(1);
  });

  it('silently cleans soft deleted cards and frees the name', async () => {
    const project = await newProject();
    const bug = await createLabel(services(), project.id, { name: 'bug', color: red });
    const card = await createCard(services(), project.id, { title: 'x' });
    await attachLabel(services(), card.id, bug.id);
    await testDb.db.$client`UPDATE cards SET deleted_at = now() WHERE id = ${card.id}`;
    const before = (await events(card.id)).length;
    await deleteLabel(services(), bug.id);
    expect(await events(card.id)).toHaveLength(before);
    await createLabel(services(), project.id, { name: 'bug', color: red });
  });

  it('survives an attach racing a delete without orphans', async () => {
    const project = await newProject();
    const bug = await createLabel(services(), project.id, { name: 'bug', color: red });
    const card = await createCard(services(), project.id, { title: 'x' });
    await Promise.allSettled([
      attachLabel(services(), card.id, bug.id),
      deleteLabel(services(), bug.id),
    ]);
    const orphans = await testDb.db.$client`
      SELECT 1 FROM card_labels WHERE label_id NOT IN (SELECT id FROM labels)`;
    expect(orphans).toHaveLength(0);
  });
});
