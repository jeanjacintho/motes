import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { createCard, deleteCard } from './cards.js';
import { addComment, deleteComment, editComment, listComments } from './comments.js';
import { Forbidden, NotFound, ValidationFailed } from './errors.js';
import { createProject } from './projects.js';

const testDb = withTestDb();
const devBot = newId('bot');
const otherBot = newId('bot');
const bot = (id: string) => ({ kind: 'bot', id }) as const;

function services(overrides: Record<string, unknown> = {}) {
  let tick = 0;
  return {
    db: testDb.db,
    appendEvent,
    // Every call moves the clock so creation order is observable.
    clock: () => new Date(Date.parse('2026-10-31T10:00:00.000Z') + ++tick * 1000),
    newId,
    botExists: async (_tx: unknown, id: string) => id === devBot || id === otherBot,
    ...overrides,
  };
}

let counter = 0;
async function newCard() {
  const key = `T${String.fromCharCode(65 + (counter % 26))}${String.fromCharCode(65 + Math.floor(counter / 26))}`;
  counter++;
  const project = await createProject(services(), { key, name: key });
  const card = await createCard(services(), project.id, { title: 'x' });
  return { project, card };
}

async function events(subjectId: string) {
  const rows = await testDb.db.$client`
    SELECT type, actor, payload FROM events WHERE subject_id = ${subjectId} ORDER BY seq`;
  return rows.map((row) => ({ type: row.type, actor: row.actor, payload: row.payload }));
}

describe('addComment', () => {
  it('stores the comment for the owner or a bot and emits one comment.created', async () => {
    const { project, card } = await newCard();
    const mine = await addComment(services(), card.id, '**Feito**');
    const theirs = await addComment(services(), card.id, 'Rodando', bot(devBot));
    expect(mine).toMatchObject({
      cardId: card.id,
      author: { type: 'owner', id: 'owner' },
      body: '**Feito**',
    });
    expect(mine.editedAt).toBeUndefined();
    expect(theirs.author).toEqual({ type: 'bot', id: devBot });
    expect(await events(theirs.id)).toEqual([
      {
        type: 'comment.created',
        actor: { kind: 'bot', id: devBot },
        payload: { projectId: project.id, cardId: card.id },
      },
    ]);
  });

  it('refuses blank bodies, unknown cards, deleted cards, unknown bots and system actors', async () => {
    const { card } = await newCard();
    await expect(addComment(services(), card.id, '  ')).rejects.toBeInstanceOf(ValidationFailed);
    await expect(addComment(services(), newId('card'), 'oi')).rejects.toBeInstanceOf(NotFound);
    await expect(addComment(services(), card.id, 'oi', bot(newId('bot')))).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(addComment(services(), card.id, 'oi', { kind: 'system' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(addComment(services(), card.id, 'oi', { kind: 'bot' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect(await listComments(services(), card.id)).toEqual([]);
    await deleteCard(services(), card.id);
    await expect(addComment(services(), card.id, 'oi')).rejects.toBeInstanceOf(NotFound);
  });

  it('rolls back when the event cannot be written', async () => {
    const { card } = await newCard();
    const failing = services({
      appendEvent: async () => {
        throw new Error('outbox down');
      },
    });
    await expect(addComment(failing, card.id, 'oi')).rejects.toThrow('outbox down');
    expect(await listComments(services(), card.id)).toEqual([]);
  });
});

describe('editComment', () => {
  it('lets the author change the body, marks it edited and emits one comment.updated', async () => {
    const { project, card } = await newCard();
    const comment = await addComment(services(), card.id, 'antes', bot(devBot));
    const edited = await editComment(services(), comment.id, 'depois', bot(devBot));
    expect(edited.body).toBe('depois');
    expect(edited.editedAt).toEqual(expect.any(String));
    expect(edited.createdAt).toBe(comment.createdAt);
    expect((await events(comment.id))[1]).toEqual({
      type: 'comment.updated',
      actor: { kind: 'bot', id: devBot },
      payload: { projectId: project.id, cardId: card.id },
    });
    expect(await editComment(services(), comment.id, 'depois', bot(devBot))).toEqual(edited);
    expect(await events(comment.id)).toHaveLength(2);
  });

  it("does not let a bot edit the owner's comment, nor anyone edit another bot's", async () => {
    const { card } = await newCard();
    const ownerComment = await addComment(services(), card.id, 'minha');
    const botComment = await addComment(services(), card.id, 'dele', bot(devBot));
    await expect(
      editComment(services(), ownerComment.id, 'hackeado', bot(devBot)),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(editComment(services(), botComment.id, 'x', bot(otherBot))).rejects.toBeInstanceOf(
      Forbidden,
    );
    // Not even the owner rewrites what a bot said.
    await expect(editComment(services(), botComment.id, 'x')).rejects.toBeInstanceOf(Forbidden);
    expect((await listComments(services(), card.id)).map((c) => c.body)).toEqual(['minha', 'dele']);
    expect(await events(ownerComment.id)).toHaveLength(1);
  });

  it('refuses blank bodies and unknown or deleted comments', async () => {
    const { card } = await newCard();
    const comment = await addComment(services(), card.id, 'oi');
    await expect(editComment(services(), comment.id, ' ')).rejects.toBeInstanceOf(ValidationFailed);
    await expect(editComment(services(), newId('comment'), 'x')).rejects.toBeInstanceOf(NotFound);
    await deleteComment(services(), comment.id);
    await expect(editComment(services(), comment.id, 'x')).rejects.toBeInstanceOf(NotFound);
  });
});

describe('deleteComment', () => {
  it('soft deletes, hides the comment from the list and emits one comment.deleted', async () => {
    const { project, card } = await newCard();
    const comment = await addComment(services(), card.id, 'oi');
    await deleteComment(services(), comment.id);
    const [row] = await testDb.db.$client`SELECT deleted_at FROM comments WHERE id = ${comment.id}`;
    expect(row?.deleted_at).not.toBeNull();
    expect(await listComments(services(), card.id)).toEqual([]);
    expect((await events(comment.id))[1]).toEqual({
      type: 'comment.deleted',
      actor: { kind: 'owner' },
      payload: { projectId: project.id, cardId: card.id },
    });
    await deleteComment(services(), comment.id);
    expect(await events(comment.id)).toHaveLength(2);
    await expect(deleteComment(services(), newId('comment'))).rejects.toBeInstanceOf(NotFound);
  });

  it('lets a bot delete only its own comments while the owner can delete any', async () => {
    const { card } = await newCard();
    const ownerComment = await addComment(services(), card.id, 'minha');
    const botComment = await addComment(services(), card.id, 'dele', bot(devBot));
    await expect(deleteComment(services(), ownerComment.id, bot(devBot))).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(deleteComment(services(), botComment.id, bot(otherBot))).rejects.toBeInstanceOf(
      Forbidden,
    );
    await deleteComment(services(), botComment.id, bot(devBot));
    await deleteComment(services(), ownerComment.id);
    expect(await listComments(services(), card.id)).toEqual([]);
    const second = await addComment(services(), card.id, 'outra', bot(devBot));
    await deleteComment(services(), second.id);
    expect(await listComments(services(), card.id)).toEqual([]);
  });
});

describe('listComments', () => {
  it('lists the live comments of a card oldest first', async () => {
    const { card } = await newCard();
    const other = await newCard();
    const first = await addComment(services(), card.id, 'um');
    await addComment(services(), other.card.id, 'outro card');
    const second = await addComment(services(), card.id, 'dois', bot(devBot));
    expect((await listComments(services(), card.id)).map((c) => c.id)).toEqual([
      first.id,
      second.id,
    ]);
    await expect(listComments(services(), newId('card'))).rejects.toBeInstanceOf(NotFound);
  });
});
