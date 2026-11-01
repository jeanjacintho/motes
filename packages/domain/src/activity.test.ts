import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { listCardActivity, replayActivity, withActivityProjection } from './activity.js';
import { moveCard } from './board.js';
import { assignCard, createCard, deleteCard, updateCard } from './cards.js';
import { addComment } from './comments.js';
import { NotFound } from './errors.js';
import { attachLabel, createLabel } from './labels.js';
import { createProject } from './projects.js';
import { changeStatus } from './status.js';

const testDb = withTestDb();

function services(append: typeof appendEvent = withActivityProjection(appendEvent)) {
  return {
    db: testDb.db,
    appendEvent: append,
    clock: () => new Date('2026-10-31T10:00:00.000Z'),
    newId,
    botExists: async () => true,
  };
}

let counter = 0;
async function newProject() {
  const key = `Y${String.fromCharCode(65 + (counter % 26))}${String.fromCharCode(65 + Math.floor(counter / 26))}`;
  counter++;
  return createProject(services(), { key, name: key });
}

// A card with one of everything that can happen to it.
async function eventful() {
  const project = await newProject();
  const label = await createLabel(services(), project.id, { name: 'bug', color: '#d73a4a' });
  const card = await createCard(services(), project.id, { title: 'Corrigir' });
  const sibling = await createCard(services(), project.id, { title: 'Outro' });
  await updateCard(services(), card.id, { title: 'Corrigir login', priority: 'high' });
  await assignCard(services(), card.id, { type: 'owner', id: 'owner' });
  await changeStatus(services(), card.id, 'todo', { kind: 'owner' }, 'Pronto para começar');
  await moveCard(services(), card.id, 'todo', { beforeId: undefined });
  await moveCard(services(), sibling.id, 'todo', { afterId: card.id });
  await attachLabel(services(), card.id, label.id);
  await addComment(services(), card.id, 'Olá');
  await deleteCard(services(), card.id);
  return { project, label, card, sibling };
}

describe('activity projection', () => {
  it('writes one line per timeline event, in order, without the project id', async () => {
    const { project, label, card } = await eventful();
    const lines = await listCardActivity(services(), card.id);
    expect(lines.map((line) => line.type)).toEqual([
      'card.created',
      'card.updated',
      'card.assigned',
      'card.status_changed',
      'card.labels_changed',
      'card.deleted',
    ]);
    expect(lines.map((line) => line.payload)).toEqual([
      { number: 1 },
      { changed: ['title', 'priority'] },
      { assignee: { type: 'owner', id: 'owner' } },
      { from: 'backlog', to: 'todo', reason: 'Pronto para começar' },
      { labelIds: [label.id] },
      {},
    ]);
    expect(lines.every((line) => !('projectId' in line.payload))).toBe(true);
    expect(lines[0]).toMatchObject({ cardId: card.id, actor: { kind: 'owner' } });
    expect(project.id).toBeDefined();
  });

  it('skips reorders and comments, and keeps cards apart', async () => {
    const { card, sibling } = await eventful();
    const types = (await listCardActivity(services(), sibling.id)).map((line) => line.type);
    expect(types).toEqual(['card.created', 'card.status_changed']);
    expect((await listCardActivity(services(), card.id)).map((l) => l.type)).not.toContain(
      'card.moved',
    );
  });

  it('is written in the transaction of the event, so a rollback leaves no line', async () => {
    const project = await newProject();
    const card = await createCard(services(), project.id, { title: 'x' });
    const append = withActivityProjection(appendEvent);
    await expect(
      testDb.db.transaction(async (tx) => {
        await append(tx, {
          id: newId('event'),
          type: 'card.deleted',
          occurredAt: '2026-10-31T10:00:00.000Z',
          actor: { kind: 'owner' },
          subject: { kind: 'card', id: card.id },
          payload: { projectId: project.id },
        });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect((await listCardActivity(services(), card.id)).map((l) => l.type)).toEqual([
      'card.created',
    ]);
  });

  it('reports unknown cards and hides deleted ones from nobody: a deleted card keeps its history', async () => {
    await expect(listCardActivity(services(), newId('card'))).rejects.toBeInstanceOf(NotFound);
    const { card } = await eventful();
    expect((await listCardActivity(services(), card.id)).at(-1)?.type).toBe('card.deleted');
  });
});

describe('activity replay', () => {
  it('rebuilds the same lines from the events after they are wiped, and is idempotent', async () => {
    const { card, sibling } = await eventful();
    const read = async () => [
      await listCardActivity(services(), card.id),
      await listCardActivity(services(), sibling.id),
    ];
    const before = await read();
    await testDb.db.$client`DELETE FROM card_activity`;
    expect((await read()).flat()).toEqual([]);
    const scanned = await replayActivity(services(), { batchSize: 3 });
    expect(scanned).toBeGreaterThan(before.flat().length);
    expect(await read()).toEqual(before);
    await replayActivity(services(), { batchSize: 200 });
    expect(await read()).toEqual(before);
  });

  it('fills in only what is missing after a partial loss', async () => {
    const { card } = await eventful();
    const before = await listCardActivity(services(), card.id);
    await testDb.db.$client`DELETE FROM card_activity WHERE id = ${before[1]?.id as string}`;
    await replayActivity(services());
    expect(await listCardActivity(services(), card.id)).toEqual(before);
  });
});
