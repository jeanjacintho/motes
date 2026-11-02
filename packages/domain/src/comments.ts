import { bots, cards, commentMentions, comments, eq, sql } from '@motes/db';
import { type Comment, commentInputSchema, commentSchema } from '@motes/protocol';
import { type CardServices, lockCard } from './cards.js';
import { Forbidden, NotFound } from './errors.js';
import { parseMentions } from './mentions.js';
import { type Actor, emit, owner, parseInput, type Tx } from './shared.js';

type Author = Comment['author'];

function toComment(row: typeof comments.$inferSelect): Comment {
  return commentSchema.parse({
    id: row.id,
    cardId: row.cardId,
    author: { type: row.authorType, id: row.authorId },
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    ...(row.editedAt ? { editedAt: row.editedAt.toISOString() } : {}),
  });
}

/** Only the owner and bots take part in a conversation; the system speaks through activity. */
function authorOf(actor: Actor): Author {
  if (actor.kind === 'owner') return { type: 'owner', id: 'owner' };
  if (actor.kind === 'bot' && actor.id) return { type: 'bot', id: actor.id };
  throw new Forbidden('Only the owner and bots can comment');
}

const sameAuthor = (row: { authorType: string; authorId: string }, author: Author) =>
  row.authorType === author.type && row.authorId === author.id;

/**
 * The live bots a body mentions, in order of appearance. Unknown and removed slugs are ignored,
 * and so is a bot mentioning itself, which would only wake it to read its own comment.
 */
async function mentionedBots(tx: Tx, body: string, author: Author): Promise<string[]> {
  const slugs = parseMentions(body);
  if (slugs.length === 0) return [];
  const rows = await tx
    .select({ id: bots.id, slug: bots.slug })
    .from(bots)
    .where(
      sql`${bots.slug} IN (${sql.join(
        slugs.map((slug) => sql`${slug}`),
        sql`, `,
      )}) AND ${bots.removedAt} IS NULL`,
    );
  return slugs
    .map((slug) => rows.find((row) => row.slug === slug)?.id)
    .filter((id): id is string => id !== undefined && !(author.type === 'bot' && id === author.id));
}

// Card lock first (which takes the project's), then the comment, which may have vanished meanwhile.
async function lockComment(tx: Tx, id: string) {
  const [peek] = await tx
    .select({ cardId: comments.cardId })
    .from(comments)
    .where(eq(comments.id, id));
  if (!peek) throw new NotFound('Comment not found');
  const card = await lockCard(tx, peek.cardId);
  const [row] = await tx.select().from(comments).where(eq(comments.id, id)).for('update');
  if (!row) throw new NotFound('Comment not found');
  return { row, card };
}

async function announceMentions(
  services: CardServices,
  tx: Tx,
  commentId: string,
  projectId: string,
  cardId: string,
  botIds: string[],
  actor: Actor,
) {
  for (const botId of botIds)
    await emit(
      services,
      tx,
      'comment.mentioned',
      { kind: 'comment', id: commentId },
      { projectId, cardId, botId },
      actor,
    );
}

export async function addComment(
  services: CardServices,
  cardId: string,
  body: string,
  actor: Actor = owner,
): Promise<Comment> {
  const input = parseInput('comment', () => commentInputSchema.safeParse({ body }));
  const author = authorOf(actor);
  return services.db.transaction(async (tx) => {
    const card = await lockCard(tx, cardId);
    if (author.type === 'bot' && !(await services.botExists(tx, author.id)))
      throw new NotFound('Bot not found');
    const [row] = await tx
      .insert(comments)
      .values({
        id: services.newId('comment'),
        cardId,
        authorType: author.type,
        authorId: author.id,
        body: input.body,
        createdAt: services.clock(),
      })
      .returning();
    if (!row) throw new Error('Comment insertion returned no row');
    const mentioned = await mentionedBots(tx, input.body, author);
    if (mentioned.length > 0)
      await tx
        .insert(commentMentions)
        .values(mentioned.map((botId) => ({ commentId: row.id, botId, createdAt: row.createdAt })));
    await emit(
      services,
      tx,
      'comment.created',
      { kind: 'comment', id: row.id },
      { projectId: card.projectId, cardId },
      actor,
    );
    await announceMentions(services, tx, row.id, card.projectId, cardId, mentioned, actor);
    return toComment(row);
  });
}

/** Only the author edits a comment; nobody rewrites another's words, the owner included. */
export async function editComment(
  services: CardServices,
  id: string,
  body: string,
  actor: Actor = owner,
): Promise<Comment> {
  const input = parseInput('comment', () => commentInputSchema.safeParse({ body }));
  const author = authorOf(actor);
  return services.db.transaction(async (tx) => {
    const { row: current, card } = await lockComment(tx, id);
    if (current.deletedAt) throw new NotFound('Comment not found');
    if (!sameAuthor(current, author)) throw new Forbidden('Only the author can edit a comment');
    if (current.body === input.body) return toComment(current);
    const [row] = await tx
      .update(comments)
      .set({ body: input.body, editedAt: services.clock() })
      .where(eq(comments.id, id))
      .returning();
    if (!row) throw new Error('Comment update returned no row');
    // The stored mentions follow the body. Only a bot that was not mentioned before is announced,
    // so editing a typo does not wake a bot again.
    const next = await mentionedBots(tx, input.body, author);
    const before = (
      await tx
        .select({ botId: commentMentions.botId })
        .from(commentMentions)
        .where(eq(commentMentions.commentId, id))
    ).map((mention) => mention.botId);
    const added = next.filter((botId) => !before.includes(botId));
    const dropped = before.filter((botId) => !next.includes(botId));
    if (dropped.length > 0)
      await tx.delete(commentMentions).where(
        sql`${commentMentions.commentId} = ${id} AND ${commentMentions.botId} IN (${sql.join(
          dropped.map((botId) => sql`${botId}`),
          sql`, `,
        )})`,
      );
    if (added.length > 0)
      await tx
        .insert(commentMentions)
        .values(added.map((botId) => ({ commentId: id, botId, createdAt: services.clock() })));
    await emit(
      services,
      tx,
      'comment.updated',
      { kind: 'comment', id },
      { projectId: card.projectId, cardId: current.cardId },
      actor,
    );
    await announceMentions(services, tx, id, card.projectId, current.cardId, added, actor);
    return toComment(row);
  });
}

/** The author deletes their own comment; the owner can delete any. Deleting twice is a no-op. */
export async function deleteComment(
  services: CardServices,
  id: string,
  actor: Actor = owner,
): Promise<void> {
  const author = authorOf(actor);
  await services.db.transaction(async (tx) => {
    const { row: current, card } = await lockComment(tx, id);
    if (author.type !== 'owner' && !sameAuthor(current, author))
      throw new Forbidden('Only the author or the owner can delete a comment');
    if (current.deletedAt) return;
    await tx.update(comments).set({ deletedAt: services.clock() }).where(eq(comments.id, id));
    await emit(
      services,
      tx,
      'comment.deleted',
      { kind: 'comment', id },
      { projectId: card.projectId, cardId: current.cardId },
      actor,
    );
  });
}

export async function listComments(services: CardServices, cardId: string): Promise<Comment[]> {
  const [card] = await services.db
    .select({ id: cards.id })
    .from(cards)
    .where(sql`${cards.id} = ${cardId} AND ${cards.deletedAt} IS NULL`);
  if (!card) throw new NotFound('Card not found');
  const rows = await services.db
    .select()
    .from(comments)
    .where(sql`${comments.cardId} = ${cardId} AND ${comments.deletedAt} IS NULL`)
    .orderBy(comments.createdAt, comments.id);
  return rows.map(toComment);
}
