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
import { cards, projectCounters, projects } from './schema.js';

export type NewCard = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status?: CardStatus;
  priority?: CardPriority;
  assignee?: { type: 'owner' | 'bot'; id: string };
  repositoryId?: string;
  createdBy: Card['createdBy'];
  now: Date;
};

function toCard(row: typeof cards.$inferSelect): Card {
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
    // Labels arrive with their own tables; no card carries one yet.
    labels: [],
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
  return toCard(row);
}

type Reader = Pick<Db, 'select'>;

export async function getCardById(db: Reader, id: string): Promise<Card | undefined> {
  const [row] = await db.select().from(cards).where(sql`${cards.id} = ${id}`);
  return row && toCard(row);
}

/** Finds a card by its "KEY-number" reference; anything malformed or unknown is undefined. */
export async function getCardByRef(db: Reader, ref: string): Promise<Card | undefined> {
  const parsed = parseCardRef(ref);
  if (!parsed) return undefined;
  const [row] = await db
    .select({ card: cards })
    .from(cards)
    .innerJoin(projects, sql`${cards.projectId} = ${projects.id}`)
    .where(sql`${projects.key} = ${parsed.key} AND ${cards.number} = ${parsed.number}`);
  return row && toCard(row.card);
}

/** Any card counts, open or closed: the foreign key keeps the repository row alive for them. */
export async function repositoryHasCards(db: Reader, repositoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(sql`${cards.repositoryId} = ${repositoryId}`)
    .limit(1);
  return row !== undefined;
}
