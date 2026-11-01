import { cards, comments, eq, sql } from '@motes/db';
import { type Comment, commentInputSchema, commentSchema } from '@motes/protocol';
import { type CardServices, lockCard } from './cards.js';
import { Forbidden, NotFound } from './errors.js';
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
    await emit(
      services,
      tx,
      'comment.created',
      { kind: 'comment', id: row.id },
      { projectId: card.projectId, cardId },
      actor,
    );
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
    await emit(
      services,
      tx,
      'comment.updated',
      { kind: 'comment', id },
      { projectId: card.projectId, cardId: current.cardId },
      actor,
    );
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
