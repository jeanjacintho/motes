import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { assignCard, createCard, deleteCard, updateCard } from './cards.js';
import { NotFound, ValidationFailed } from './errors.js';
import { createProject } from './projects.js';
import { addRepository } from './repositories.js';

const testDb = withTestDb();
const knownBot = newId('bot');

function services(overrides: Record<string, unknown> = {}) {
  return {
    db: testDb.db,
    appendEvent,
    clock: () => new Date('2026-10-31T10:00:00.000Z'),
    newId,
    botExists: async (_tx: unknown, id: string) => id === knownBot,
    ...overrides,
  };
}

let counter = 0;
async function setup(repositories = 1) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const key = `C${letters[counter % 26]}${letters[Math.floor(counter / 26) % 26]}`;
  counter++;
  const project = await createProject(services(), { key, name: `Project ${key}` });
  const repos = [];
  for (let index = 0; index < repositories; index++)
    repos.push(
      await addRepository(services(), project.id, {
        name: `repo${index}`,
        remoteUrl: `git@example.com:owner/repo${index}.git`,
        defaultBranch: 'main',
      }),
    );
  return { project, repos };
}

async function events(subjectId: string) {
  const rows = await testDb.db.$client`
    SELECT type, actor, payload FROM events WHERE subject_id = ${subjectId} ORDER BY seq`;
  return rows.map((row) => ({ type: row.type, actor: row.actor, payload: row.payload }));
}

describe('createCard', () => {
  it('numbers the card, defaults to the primary repository and emits one card.created', async () => {
    const { project, repos } = await setup(2);
    const card = await createCard(services(), project.id, { title: 'Corrigir typo' });
    expect(card).toMatchObject({
      number: 1,
      status: 'backlog',
      priority: 'none',
      repositoryId: repos[0]?.id,
      createdBy: { type: 'owner', id: 'owner' },
    });
    expect(await events(card.id)).toEqual([
      {
        type: 'card.created',
        actor: { kind: 'owner' },
        payload: { projectId: project.id, number: 1 },
      },
    ]);
    expect((await createCard(services(), project.id, { title: 'Outro' })).number).toBe(2);
  });

  it('leaves the repository empty when the project has none', async () => {
    const { project } = await setup(0);
    expect((await createCard(services(), project.id, { title: 'x' })).repositoryId).toBeUndefined();
  });

  it('accepts a repository of the project and an assignable bot', async () => {
    const { project, repos } = await setup(2);
    const card = await createCard(services(), project.id, {
      title: 'x',
      repositoryId: repos[1]?.id,
      assignee: { type: 'bot', id: knownBot },
    });
    expect(card).toMatchObject({
      repositoryId: repos[1]?.id,
      assignee: { type: 'bot', id: knownBot },
    });
  });

  it('refuses a repository of another project, an unknown bot and bad input, without a trace', async () => {
    const { project } = await setup(1);
    const other = await setup(1);
    await expect(
      createCard(services(), project.id, { title: 'x', repositoryId: other.repos[0]?.id }),
    ).rejects.toBeInstanceOf(ValidationFailed);
    await expect(
      createCard(services(), project.id, {
        title: 'x',
        assignee: { type: 'bot', id: newId('bot') },
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(createCard(services(), project.id, { title: ' ' })).rejects.toBeInstanceOf(
      ValidationFailed,
    );
    await expect(createCard(services(), newId('project'), { title: 'x' })).rejects.toBeInstanceOf(
      NotFound,
    );
    // Every refusal rolled back, so the next card still gets number 1.
    expect((await createCard(services(), project.id, { title: 'x' })).number).toBe(1);
  });

  it('records who created the card', async () => {
    const { project } = await setup(0);
    const bot = await createCard(
      services(),
      project.id,
      { title: 'x' },
      { kind: 'bot', id: knownBot },
    );
    const system = await createCard(services(), project.id, { title: 'y' }, { kind: 'system' });
    expect(bot.createdBy).toEqual({ type: 'bot', id: knownBot });
    expect(system.createdBy).toEqual({ type: 'system', id: 'system' });
    expect((await events(bot.id))[0]?.actor).toEqual({ kind: 'bot', id: knownBot });
  });

  it('rolls back the card when the event cannot be written', async () => {
    const { project } = await setup(0);
    const failing = services({
      appendEvent: async () => {
        throw new Error('outbox down');
      },
    });
    await expect(createCard(failing, project.id, { title: 'x' })).rejects.toThrow('outbox down');
    expect((await createCard(services(), project.id, { title: 'x' })).number).toBe(1);
  });
});

describe('updateCard', () => {
  it('changes the named fields and emits one card.updated listing them', async () => {
    const { project, repos } = await setup(2);
    const card = await createCard(services(), project.id, { title: 'Antes' });
    const later = services({ clock: () => new Date('2026-10-31T11:00:00.000Z') });
    const updated = await updateCard(later, card.id, {
      title: 'Depois',
      priority: 'high',
      repositoryId: repos[1]?.id,
    });
    expect(updated).toMatchObject({
      title: 'Depois',
      priority: 'high',
      repositoryId: repos[1]?.id,
      description: '',
      updatedAt: '2026-10-31T11:00:00.000Z',
    });
    const [, change] = await events(card.id);
    expect(change).toEqual({
      type: 'card.updated',
      actor: { kind: 'owner' },
      payload: { projectId: project.id, changed: ['title', 'priority', 'repositoryId'] },
    });
  });

  it('lists only fields whose value really changed and emits nothing for a no-op', async () => {
    const { project } = await setup(1);
    const card = await createCard(services(), project.id, { title: 'Igual', priority: 'low' });
    expect(
      await updateCard(services(), card.id, { title: 'Igual', priority: 'low', description: '' }),
    ).toEqual(card);
    await updateCard(services(), card.id, { title: 'Igual', description: 'Mais' });
    expect(await events(card.id)).toHaveLength(2);
    expect((await events(card.id))[1]?.payload).toEqual({
      projectId: project.id,
      changed: ['description'],
    });
  });

  it('refuses a foreign repository, unknown or deleted cards and bad input', async () => {
    const { project } = await setup(1);
    const other = await setup(1);
    const card = await createCard(services(), project.id, { title: 'x' });
    await expect(
      updateCard(services(), card.id, { repositoryId: other.repos[0]?.id }),
    ).rejects.toBeInstanceOf(ValidationFailed);
    await expect(updateCard(services(), card.id, { title: '' })).rejects.toBeInstanceOf(
      ValidationFailed,
    );
    await expect(updateCard(services(), newId('card'), { title: 'y' })).rejects.toBeInstanceOf(
      NotFound,
    );
    await deleteCard(services(), card.id);
    await expect(updateCard(services(), card.id, { title: 'y' })).rejects.toBeInstanceOf(NotFound);
    expect(await events(card.id)).toHaveLength(2);
  });
});

describe('assignCard', () => {
  it('assigns to the owner or a bot, then clears, one card.assigned each', async () => {
    const { project } = await setup(0);
    const card = await createCard(services(), project.id, { title: 'x' });
    const toBot = await assignCard(services(), card.id, { type: 'bot', id: knownBot });
    expect(toBot.assignee).toEqual({ type: 'bot', id: knownBot });
    await assignCard(services(), card.id, { type: 'owner', id: 'owner' });
    const cleared = await assignCard(services(), card.id, null);
    expect(cleared.assignee).toBeUndefined();
    expect((await events(card.id)).slice(1).map((event) => event.payload)).toEqual([
      { projectId: project.id, assignee: { type: 'bot', id: knownBot } },
      { projectId: project.id, assignee: { type: 'owner', id: 'owner' } },
      { projectId: project.id, assignee: null },
    ]);
  });

  it('emits nothing when the assignee does not change', async () => {
    const { project } = await setup(0);
    const card = await createCard(services(), project.id, { title: 'x' });
    await assignCard(services(), card.id, null);
    await assignCard(services(), card.id, { type: 'bot', id: knownBot });
    await assignCard(services(), card.id, { type: 'bot', id: knownBot });
    expect(await events(card.id)).toHaveLength(2);
  });

  it('refuses an unknown bot with NotFound and leaves the assignee alone', async () => {
    const { project } = await setup(0);
    const card = await createCard(services(), project.id, {
      title: 'x',
      assignee: { type: 'bot', id: knownBot },
    });
    await expect(
      assignCard(services(), card.id, { type: 'bot', id: newId('bot') }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(assignCard(services(), newId('card'), null)).rejects.toBeInstanceOf(NotFound);
    await expect(
      assignCard(services(), card.id, { type: 'robot', id: 'x' } as never),
    ).rejects.toBeInstanceOf(ValidationFailed);
    const [row] = await testDb.db.$client`SELECT assignee_id FROM cards WHERE id = ${card.id}`;
    expect(row?.assignee_id).toBe(knownBot);
  });
});

describe('deleteCard', () => {
  it('soft deletes, keeps the row and its number, and emits one card.deleted', async () => {
    const { project } = await setup(0);
    const card = await createCard(services(), project.id, { title: 'x' });
    await deleteCard(services(), card.id);
    const [row] = await testDb.db.$client`SELECT deleted_at FROM cards WHERE id = ${card.id}`;
    expect(row?.deleted_at).not.toBeNull();
    expect((await events(card.id))[1]).toEqual({
      type: 'card.deleted',
      actor: { kind: 'owner' },
      payload: { projectId: project.id },
    });
    expect((await createCard(services(), project.id, { title: 'y' })).number).toBe(2);
  });

  it('is idempotent and reports unknown cards', async () => {
    const { project } = await setup(0);
    const card = await createCard(services(), project.id, { title: 'x' });
    await deleteCard(services(), card.id);
    await deleteCard(services(), card.id);
    expect(await events(card.id)).toHaveLength(2);
    await expect(deleteCard(services(), newId('card'))).rejects.toBeInstanceOf(NotFound);
  });
});

describe('concurrency', () => {
  it('serializes concurrent updates so each change is reported once', async () => {
    const { project } = await setup(0);
    const card = await createCard(services(), project.id, { title: 'x' });
    await Promise.all([
      updateCard(services(), card.id, { priority: 'high' }),
      updateCard(services(), card.id, { priority: 'high' }),
      updateCard(services(), card.id, { priority: 'high' }),
    ]);
    expect(await events(card.id)).toHaveLength(2);
  });
});
