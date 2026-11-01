import {
  type Card,
  type CardPriority,
  type CardStatus,
  cardSchema,
  parseCardRef,
} from '@motes/protocol';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from './events.js';
import type { Db } from './index.js';
import { cardLabels, cards, labels, projectCounters, projects } from './schema.js';

export type NewCard = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status?: CardStatus;
  priority?: CardPriority;
  /** Fractional key; unique among the live cards of the same project and status. */
  position: string;
  assignee?: { type: 'owner' | 'bot'; id: string };
  repositoryId?: string;
  createdBy: Card['createdBy'];
  now: Date;
};

export function cardFromRow(row: typeof cards.$inferSelect, labelIds: string[] = []): Card {
  return cardSchema.parse({
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    ...(row.assigneeType && row.assigneeId
      ? { assignee: { type: row.assigneeType, id: row.assigneeId } }
      : {}),
    ...(row.repositoryId ? { repositoryId: row.repositoryId } : {}),
    labels: labelIds,
    createdBy: { type: row.createdByType, id: row.createdById },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Takes the project's next number. The upsert locks the counter row until the transaction ends,
 * so concurrent inserts queue up and a rollback gives the number back: no gaps, no duplicates.
 */
async function allocateNumber(tx: DbTransaction, projectId: string): Promise<number> {
  const [row] = await tx
    .insert(projectCounters)
    .values({ projectId, lastNumber: 1 })
    .onConflictDoUpdate({
      target: projectCounters.projectId,
      set: { lastNumber: sql`${projectCounters.lastNumber} + 1` },
    })
    .returning({ lastNumber: projectCounters.lastNumber });
  if (!row) throw new Error('Card number allocation returned no row');
  return row.lastNumber;
}

/** Runs inside the caller's transaction so the number is held until the card commits. */
export async function insertCard(tx: DbTransaction, input: NewCard): Promise<Card> {
  const number = await allocateNumber(tx, input.projectId);
  const [row] = await tx
    .insert(cards)
    .values({
      id: input.id,
      projectId: input.projectId,
      number,
      title: input.title,
      description: input.description ?? '',
      status: input.status ?? 'backlog',
      priority: input.priority ?? 'none',
      position: input.position,
      assigneeType: input.assignee?.type ?? null,
      assigneeId: input.assignee?.id ?? null,
      repositoryId: input.repositoryId ?? null,
      createdByType: input.createdBy.type,
      createdById: input.createdBy.id,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();
  if (!row) throw new Error('Card insertion returned no row');
  return cardFromRow(row);
}

type Reader = Pick<Db, 'select'>;

/** The card's label ids in label-name order, so the same set always reads the same way. */
export async function cardLabelIds(db: Reader, cardId: string): Promise<string[]> {
  const rows = await db
    .select({ id: labels.id })
    .from(cardLabels)
    .innerJoin(labels, sql`${cardLabels.labelId} = ${labels.id}`)
    .where(sql`${cardLabels.cardId} = ${cardId}`)
    .orderBy(sql`lower(${labels.name}), ${labels.id}`);
  return rows.map((row) => row.id);
}

export async function getCardById(db: Reader, id: string): Promise<Card | undefined> {
  const [row] = await db
    .select()
    .from(cards)
    .where(sql`${cards.id} = ${id} AND ${cards.deletedAt} IS NULL`);
  return row && cardFromRow(row, await cardLabelIds(db, row.id));
}

/** Finds a card by its "KEY-number" reference; anything malformed or unknown is undefined. */
export async function getCardByRef(db: Reader, ref: string): Promise<Card | undefined> {
  const parsed = parseCardRef(ref);
  if (!parsed) return undefined;
  const [row] = await db
    .select({ card: cards })
    .from(cards)
    .innerJoin(projects, sql`${cards.projectId} = ${projects.id}`)
    .where(
      sql`${projects.key} = ${parsed.key} AND ${cards.number} = ${parsed.number} AND ${cards.deletedAt} IS NULL`,
    );
  return row && cardFromRow(row.card, await cardLabelIds(db, row.card.id));
}

/** Any card counts, open, closed or deleted: the foreign key keeps the repository row alive for them. */
export async function repositoryHasCards(db: Reader, repositoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(sql`${cards.repositoryId} = ${repositoryId}`)
    .limit(1);
  return row !== undefined;
}

export type BoardQuery = {
  assignee?: { type: 'owner' | 'bot'; id: string };
  labelId?: string;
  priority?: CardPriority;
  text?: string;
};

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * The project's live cards, top to bottom within each status. Filters combine with AND; the
 * labels of all returned cards come from a single query.
 */
export async function listBoardCards(
  db: Reader,
  projectId: string,
  query: BoardQuery = {},
): Promise<Card[]> {
  const conditions = [sql`${cards.projectId} = ${projectId}`, sql`${cards.deletedAt} IS NULL`];
  if (query.assignee)
    conditions.push(
      sql`${cards.assigneeType} = ${query.assignee.type} AND ${cards.assigneeId} = ${query.assignee.id}`,
    );
  if (query.priority) conditions.push(sql`${cards.priority} = ${query.priority}`);
  if (query.text)
    conditions.push(sql`${cards.title} ILIKE ${`%${escapeLike(query.text)}%`} ESCAPE '\\'`);
  if (query.labelId)
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${cardLabels} WHERE ${cardLabels.cardId} = ${cards.id} AND ${cardLabels.labelId} = ${query.labelId})`,
    );
  const rows = await db
    .select()
    .from(cards)
    .where(sql.join(conditions, sql` AND `))
    .orderBy(sql`${cards.position} COLLATE "C"`, cards.id);
  if (rows.length === 0) return [];
  const links = await db
    .select({ cardId: cardLabels.cardId, labelId: labels.id })
    .from(cardLabels)
    .innerJoin(labels, sql`${cardLabels.labelId} = ${labels.id}`)
    .where(
      sql`${cardLabels.cardId} IN (${sql.join(
        rows.map((row) => sql`${row.id}`),
        sql`, `,
      )})`,
    )
    .orderBy(sql`lower(${labels.name}), ${labels.id}`);
  const byCard = new Map<string, string[]>();
  for (const link of links)
    byCard.set(link.cardId, [...(byCard.get(link.cardId) ?? []), link.labelId]);
  return rows.map((row) => cardFromRow(row, byCard.get(row.id) ?? []));
}

/** The position of the lowest live card of the column, or undefined when it is empty. */
export async function lastPosition(
  db: Reader,
  projectId: string,
  status: CardStatus,
): Promise<string | undefined> {
  const [row] = await db
    .select({ position: cards.position })
    .from(cards)
    .where(
      sql`${cards.projectId} = ${projectId} AND ${cards.status} = ${status} AND ${cards.deletedAt} IS NULL`,
    )
    .orderBy(sql`${cards.position} COLLATE "C" DESC`)
    .limit(1);
  return row?.position;
}
