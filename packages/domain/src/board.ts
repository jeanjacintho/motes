import { cards, eq, listBoardCards, projects, sql } from '@motes/db';
import {
  type Board,
  type BoardFilters,
  boardFiltersSchema,
  CARD_STATUSES,
  type Card,
  type CardStatus,
  changeStatusInputSchema,
} from '@motes/protocol';
import { lockCard, present } from './cards.js';
import { NotFound, ValidationFailed } from './errors.js';
import { positionBetween } from './position.js';
import { type Actor, emit, owner, parseInput, type Services, type Tx } from './shared.js';
import { transition } from './status.js';

type Row = typeof cards.$inferSelect;

// Both look at the live cards of one column other than the moved card, in byte order.
async function positionBelow(
  tx: Tx,
  card: Row,
  status: CardStatus,
  limit?: string,
): Promise<string | undefined> {
  const [row] = await tx
    .select({ position: cards.position })
    .from(cards)
    .where(
      sql`${cards.projectId} = ${card.projectId} AND ${cards.status} = ${status}
        AND ${cards.deletedAt} IS NULL AND ${cards.id} <> ${card.id}
        ${limit === undefined ? sql`` : sql`AND ${cards.position} COLLATE "C" < ${limit} COLLATE "C"`}`,
    )
    .orderBy(sql`${cards.position} COLLATE "C" DESC`)
    .limit(1);
  return row?.position;
}

async function positionAbove(
  tx: Tx,
  card: Row,
  status: CardStatus,
  limit: string,
): Promise<string | undefined> {
  const [row] = await tx
    .select({ position: cards.position })
    .from(cards)
    .where(
      sql`${cards.projectId} = ${card.projectId} AND ${cards.status} = ${status}
        AND ${cards.deletedAt} IS NULL AND ${cards.id} <> ${card.id}
        AND ${cards.position} COLLATE "C" > ${limit} COLLATE "C"`,
    )
    .orderBy(sql`${cards.position} COLLATE "C"`)
    .limit(1);
  return row?.position;
}

async function neighbour(tx: Tx, card: Row, id: string | undefined, status: CardStatus) {
  if (id === undefined) return undefined;
  const [row] = await tx.select().from(cards).where(eq(cards.id, id));
  if (!row || row.deletedAt || row.projectId !== card.projectId || row.status !== status)
    throw new ValidationFailed('The neighbour card is not in the target column');
  if (row.id === card.id) throw new ValidationFailed('A card cannot be placed next to itself');
  return row;
}

/**
 * Moves a card to `toStatus` and places it: `afterId` is the card that ends up directly above it,
 * `beforeId` the one directly below. With neither it goes to the bottom of the column. Changing
 * column is a status change (same rules, `card.status_changed`); staying put only reorders and
 * emits `card.moved`. Only the moved card is written.
 */
export async function moveCard(
  services: Services,
  id: string,
  toStatus: CardStatus,
  place: { beforeId?: string | undefined; afterId?: string | undefined } = {},
  actor: Actor = owner,
  reason?: string,
): Promise<Card> {
  const input = parseInput('move', () =>
    changeStatusInputSchema.safeParse({ to: toStatus, reason }),
  );
  return services.db.transaction(async (tx) => {
    const current = await lockCard(tx, id);
    const before = await neighbour(tx, current, place.beforeId, input.to);
    const after = await neighbour(tx, current, place.afterId, input.to);
    let lower: string | undefined;
    let upper: string | undefined;
    if (before && after) {
      lower = after.position;
      upper = before.position;
      if (!(lower < upper))
        throw new ValidationFailed('The card must go after afterId and before beforeId');
    } else if (before) {
      upper = before.position;
      lower = await positionBelow(tx, current, input.to, upper);
    } else if (after) {
      lower = after.position;
      upper = await positionAbove(tx, current, input.to, lower);
    } else {
      lower = await positionBelow(tx, current, input.to);
    }
    const sameColumn = current.status === input.to;
    const inPlace =
      (lower === undefined || lower < current.position) &&
      (upper === undefined || current.position < upper);
    if (sameColumn && inPlace) return present(tx, current);
    const position = positionBetween(lower, upper);
    if (!sameColumn)
      return present(tx, await transition(services, tx, current, input, actor, position));
    const [row] = await tx
      .update(cards)
      .set({ position, updatedAt: services.clock() })
      .where(eq(cards.id, id))
      .returning();
    if (!row) throw new Error('Card update returned no row');
    await emit(
      services,
      tx,
      'card.moved',
      { kind: 'card', id },
      { projectId: row.projectId, status: input.to },
      actor,
    );
    return present(tx, row);
  });
}

/** Every status gets a column, empty or not; filters combine with AND. */
export async function getBoard(
  services: Services,
  projectId: string,
  filters: BoardFilters = {},
): Promise<Board> {
  const query = parseInput('board filters', () => boardFiltersSchema.safeParse(filters));
  const [project] = await services.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new NotFound('Project not found');
  const found = await listBoardCards(services.db, projectId, query);
  return {
    columns: CARD_STATUSES.map((status) => ({
      status,
      cards: found.filter((card) => card.status === status),
    })),
  };
}
