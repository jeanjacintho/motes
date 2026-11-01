import { appendEvent, bots } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { describe, expect, it } from 'vitest';
import { createCard } from './cards.js';
import { addComment, deleteComment, editComment } from './comments.js';
import { createProject } from './projects.js';

const testDb = withTestDb();

function services(overrides: Record<string, unknown> = {}) {
  let tick = 0;
  return {
    db: testDb.db,
    appendEvent,
    clock: () => new Date(Date.parse('2026-10-31T10:00:00.000Z') + ++tick * 1000),
    newId,
    botExists: async () => true,
    ...overrides,
  };
}

let counter = 0;
async function newBot(slug: string, removed = false) {
  const id = newId('bot');
  const now = new Date('2026-10-31T10:00:00.000Z');
  await testDb.db.insert(bots).values({
    id,
    slug,
    displayName: slug,
    kind: 'dev',
    engines: ['claude'],
    enabled: true,
    skillDigest: 'a'.repeat(64),
    createdAt: now,
    updatedAt: now,
    removedAt: removed ? now : null,
  });
  return id;
}

async function setup() {
  const key = `M${String.fromCharCode(65 + (counter % 26))}${String.fromCharCode(65 + Math.floor(counter / 26))}`;
  counter++;
  const project = await createProject(services(), { key, name: key });
  const card = await createCard(services(), project.id, { title: 'x' });
  return { project, card };
}

async function events(commentId: string) {
  const rows = await testDb.db.$client`
    SELECT type, payload FROM events WHERE subject_id = ${commentId} ORDER BY seq`;
  return rows.map((row) => [row.type, row.payload.botId] as const);
}

const stored = async (commentId: string) =>
  (await testDb.db.$client`SELECT bot_id FROM comment_mentions WHERE comment_id = ${commentId}`)
    .map((row) => row.bot_id as string)
    .sort();

describe('mentions in a new comment', () => {
  it('stores each mentioned bot and emits comment.created, then one comment.mentioned per bot', async () => {
    const { project, card } = await setup();
    const dev = await newBot('dev-a');
    const qa = await newBot('qa-a');
    const comment = await addComment(services(), card.id, '@dev-a corrige e @qa-a testa, @dev-a?');
    expect(await stored(comment.id)).toEqual([dev, qa].sort());
    expect(await events(comment.id)).toEqual([
      ['comment.created', undefined],
      ['comment.mentioned', dev],
      ['comment.mentioned', qa],
    ]);
    const [row] = await testDb.db.$client`
      SELECT payload FROM events WHERE type = 'comment.mentioned' AND subject_id = ${comment.id} LIMIT 1`;
    expect(row?.payload).toEqual({ projectId: project.id, cardId: card.id, botId: dev });
  });

  it('ignores unknown slugs, removed bots and mentions inside code or quotes', async () => {
    const { card } = await setup();
    await newBot('gone-a', true);
    const live = await newBot('live-a');
    const body = [
      '@nobody-here e @gone-a não existem.',
      'Código: `@live-a` e',
      '```',
      '@live-a',
      '```',
      '> @live-a citado',
      'email@live-a.com',
    ].join('\n');
    const comment = await addComment(services(), card.id, body);
    expect(await stored(comment.id)).toEqual([]);
    expect(await events(comment.id)).toEqual([['comment.created', undefined]]);
    const second = await addComment(services(), card.id, 'agora sim @live-a');
    expect(await stored(second.id)).toEqual([live]);
  });

  it('does not announce a bot that mentions itself, but does for another bot', async () => {
    const { card } = await setup();
    const me = await newBot('me-a');
    const other = await newBot('other-a');
    const comment = await addComment(services(), card.id, '@me-a e @other-a', {
      kind: 'bot',
      id: me,
    });
    expect(await stored(comment.id)).toEqual([other]);
    expect(await events(comment.id).then((list) => list.map(([type]) => type))).toEqual([
      'comment.created',
      'comment.mentioned',
    ]);
  });

  it('rolls everything back when the outbox fails', async () => {
    const { card } = await setup();
    const dev = await newBot('roll-a');
    const failing = services({
      appendEvent: async (...args: Parameters<typeof appendEvent>) => {
        if ((args[1] as { type: string }).type === 'comment.mentioned')
          throw new Error('outbox down');
        return appendEvent(...args);
      },
    });
    await expect(addComment(failing, card.id, '@roll-a')).rejects.toThrow('outbox down');
    const rows = await testDb.db.$client`
      SELECT 1 FROM comment_mentions WHERE bot_id = ${dev}`;
    expect(rows).toHaveLength(0);
  });
});

describe('mentions in an edited comment', () => {
  it('announces only bots mentioned for the first time, and drops the ones removed', async () => {
    const { card } = await setup();
    const dev = await newBot('edit-dev');
    const qa = await newBot('edit-qa');
    const comment = await addComment(services(), card.id, '@edit-dev olha');
    await editComment(services(), comment.id, '@edit-dev olha de novo, typo corrigido');
    expect(await events(comment.id).then((list) => list.map(([type]) => type))).toEqual([
      'comment.created',
      'comment.mentioned',
      'comment.updated',
    ]);
    await editComment(services(), comment.id, '@edit-dev e @edit-qa');
    expect((await events(comment.id)).slice(3)).toEqual([
      ['comment.updated', undefined],
      ['comment.mentioned', qa],
    ]);
    expect(await stored(comment.id)).toEqual([dev, qa].sort());
    await editComment(services(), comment.id, 'só @edit-qa agora');
    expect(await stored(comment.id)).toEqual([qa]);
    // A bot mentioned again after it was dropped is a new mention.
    await editComment(services(), comment.id, '@edit-dev voltou, @edit-qa também');
    const last = await events(comment.id);
    expect(last.at(-1)).toEqual(['comment.mentioned', dev]);
    expect(await stored(comment.id)).toEqual([dev, qa].sort());
  });

  it('keeps the mention rows and announces nothing more when the comment is deleted', async () => {
    const { card } = await setup();
    const dev = await newBot('del-dev');
    const comment = await addComment(services(), card.id, '@del-dev');
    await deleteComment(services(), comment.id);
    expect(await stored(comment.id)).toEqual([dev]);
    expect((await events(comment.id)).map(([type]) => type)).toEqual([
      'comment.created',
      'comment.mentioned',
      'comment.deleted',
    ]);
  });
});
