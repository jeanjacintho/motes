import { cards, eq, lastPosition } from '@motes/db';
import { type CardStatus, type ChangeStatusInput, changeStatusInputSchema } from '@motes/protocol';
import { lockCard, present } from './cards.js';
import { Conflict, Forbidden } from './errors.js';
import { positionBetween } from './position.js';
import { type Actor, emit, owner, parseInput, type Services, type Tx } from './shared.js';

/**
 * Where each status may go. Done reopens only to todo; a cancelled card is brought back through
 * the planning statuses; cancelling is possible from every status except done.
 */
export const STATUS_TRANSITIONS: Readonly<Record<CardStatus, readonly CardStatus[]>> = {
  backlog: ['todo', 'blocked', 'cancelled'],
  todo: ['backlog', 'in_progress', 'blocked', 'cancelled'],
  in_progress: ['todo', 'in_review', 'blocked', 'cancelled'],
  in_review: ['in_progress', 'done', 'blocked', 'cancelled'],
  done: ['todo'],
  blocked: ['backlog', 'todo', 'in_progress', 'cancelled'],
  cancelled: ['backlog', 'todo'],
};

/** Set by the system when a run starts or a pull request opens; the owner can still set them. */
export const SYSTEM_STATUSES: readonly CardStatus[] = ['in_progress', 'in_review'];

const SYSTEM_ACTORS: readonly Actor['kind'][] = ['owner', 'system', 'runtime'];

export function canTransition(from: CardStatus, to: CardStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

type Row = typeof cards.$inferSelect;

/**
 * Validates and applies one transition inside the caller's transaction. A card entering a column
 * goes to its bottom unless the caller supplies a position.
 */
export async function transition(
  services: Services,
  tx: Tx,
  current: Row,
  input: ChangeStatusInput,
  actor: Actor,
  position?: string,
): Promise<Row> {
  const from = current.status as CardStatus;
  if (!canTransition(from, input.to))
    throw new Conflict(`A card cannot move from ${from} to ${input.to}`);
  if (SYSTEM_STATUSES.includes(input.to) && !SYSTEM_ACTORS.includes(actor.kind))
    throw new Forbidden(`Only the system or the owner can set ${input.to}`);
  const [row] = await tx
    .update(cards)
    .set({
      status: input.to,
      position:
        position ?? positionBetween(await lastPosition(tx, current.projectId, input.to), undefined),
      updatedAt: services.clock(),
    })
    .where(eq(cards.id, current.id))
    .returning();
  if (!row) throw new Error('Card update returned no row');
  await emit(
    services,
    tx,
    'card.status_changed',
    { kind: 'card', id: current.id },
    { projectId: row.projectId, from, to: input.to, reason: input.reason ?? null },
    actor,
  );
  return row;
}

export async function changeStatus(
  services: Services,
  id: string,
  to: CardStatus,
  actor: Actor = owner,
  reason?: string,
) {
  const input: ChangeStatusInput = parseInput('status change', () =>
    changeStatusInputSchema.safeParse({ to, reason }),
  );
  return services.db.transaction(async (tx) => {
    const current = await lockCard(tx, id);
    if (current.status === input.to) return present(tx, current);
    return present(tx, await transition(services, tx, current, input, actor));
  });
}
