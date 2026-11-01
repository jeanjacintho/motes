import {
  cardFromRow,
  cardLabelIds,
  cards,
  eq,
  getCardById,
  getCardByRef,
  insertCard,
  lastPosition,
  projects,
  repositories,
  sql,
} from '@motes/db';
import {
  assignCardInputSchema,
  CARD_EDITABLE_FIELDS,
  type Card,
  type CreateCardInput,
  createCardInputSchema,
  ID_PREFIXES,
  type UpdateCardInput,
  updateCardInputSchema,
} from '@motes/protocol';
import { NotFound, ValidationFailed } from './errors.js';
import { positionBetween } from './position.js';
import { type Actor, emit, owner, parseInput, type Services, type Tx } from './shared.js';

/** `botExists` is supplied at composition time; bots live in a module this one does not know. */
export type CardServices = Services & {
  botExists: (tx: Tx, botId: string) => Promise<boolean>;
};

type Assignee = NonNullable<Card['assignee']>;

// Serializes changes within a project, the same lock repositories take before they move or vanish.
async function lockProject(tx: Tx, projectId: string) {
  const [row] = await tx.select().from(projects).where(eq(projects.id, projectId)).for('update');
  if (!row) throw new NotFound('Project not found');
}

/** Project lock first, then the card, so concurrent mutations of one card queue up. */
export async function lockCard(tx: Tx, id: string, options: { allowDeleted?: boolean } = {}) {
  const [peek] = await tx
    .select({ projectId: cards.projectId })
    .from(cards)
    .where(eq(cards.id, id));
  if (!peek) throw new NotFound('Card not found');
  await lockProject(tx, peek.projectId);
  const [row] = await tx.select().from(cards).where(eq(cards.id, id)).for('update');
  if (!row || (row.deletedAt && !options.allowDeleted)) throw new NotFound('Card not found');
  return row;
}

/** A card as clients see it, with its labels read inside the same transaction. */
export async function present(tx: Tx, row: typeof cards.$inferSelect) {
  return cardFromRow(row, await cardLabelIds(tx, row.id));
}

async function checkRepository(tx: Tx, projectId: string, repositoryId: string) {
  const [row] = await tx
    .select({ projectId: repositories.projectId })
    .from(repositories)
    .where(eq(repositories.id, repositoryId));
  if (row?.projectId !== projectId)
    throw new ValidationFailed('Repository does not belong to the card project');
}

async function primaryRepositoryId(tx: Tx, projectId: string) {
  const [row] = await tx
    .select({ id: repositories.id })
    .from(repositories)
    .where(sql`${repositories.projectId} = ${projectId} AND ${repositories.isPrimary}`);
  return row?.id;
}

async function checkAssignee(services: CardServices, tx: Tx, assignee: Assignee | null) {
  if (assignee?.type === 'bot' && !(await services.botExists(tx, assignee.id)))
    throw new NotFound('Bot not found');
}

function creator(actor: Actor): Card['createdBy'] {
  if (actor.kind === 'owner') return { type: 'owner', id: 'owner' };
  if (actor.kind === 'bot' && actor.id) return { type: 'bot', id: actor.id };
  return { type: 'system', id: actor.id ?? 'system' };
}

export async function createCard(
  services: CardServices,
  projectId: string,
  input: CreateCardInput,
  actor: Actor = owner,
): Promise<Card> {
  const data = parseInput('card', () => createCardInputSchema.safeParse(input));
  return services.db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    if (data.repositoryId) await checkRepository(tx, projectId, data.repositoryId);
    await checkAssignee(services, tx, data.assignee ?? null);
    const repositoryId = data.repositoryId ?? (await primaryRepositoryId(tx, projectId));
    const card = await insertCard(tx, {
      id: services.newId('card'),
      projectId,
      title: data.title,
      description: data.description,
      priority: data.priority,
      position: positionBetween(await lastPosition(tx, projectId, 'backlog'), undefined),
      ...(data.assignee ? { assignee: data.assignee } : {}),
      ...(repositoryId ? { repositoryId } : {}),
      createdBy: creator(actor),
      now: services.clock(),
    });
    await emit(
      services,
      tx,
      'card.created',
      { kind: 'card', id: card.id },
      { projectId, number: card.number },
      actor,
    );
    return card;
  });
}

export async function updateCard(
  services: CardServices,
  id: string,
  input: UpdateCardInput,
  actor: Actor = owner,
): Promise<Card> {
  const patch = parseInput('card', () => updateCardInputSchema.safeParse(input));
  return services.db.transaction(async (tx) => {
    const current = await lockCard(tx, id);
    if (patch.repositoryId) await checkRepository(tx, current.projectId, patch.repositoryId);
    const changed = CARD_EDITABLE_FIELDS.filter(
      (field) => patch[field] !== undefined && patch[field] !== current[field],
    );
    if (changed.length === 0) return present(tx, current);
    const [row] = await tx
      .update(cards)
      .set({ ...patch, updatedAt: services.clock() })
      .where(eq(cards.id, id))
      .returning();
    if (!row) throw new Error('Card update returned no row');
    await emit(
      services,
      tx,
      'card.updated',
      { kind: 'card', id },
      { projectId: row.projectId, changed },
      actor,
    );
    return present(tx, row);
  });
}

export async function assignCard(
  services: CardServices,
  id: string,
  assignee: Assignee | null,
  actor: Actor = owner,
): Promise<Card> {
  const next = parseInput('assignee', () => assignCardInputSchema.safeParse(assignee));
  return services.db.transaction(async (tx) => {
    const current = await lockCard(tx, id);
    if (current.assigneeType === (next?.type ?? null) && current.assigneeId === (next?.id ?? null))
      return present(tx, current);
    await checkAssignee(services, tx, next);
    const [row] = await tx
      .update(cards)
      .set({
        assigneeType: next?.type ?? null,
        assigneeId: next?.id ?? null,
        updatedAt: services.clock(),
      })
      .where(eq(cards.id, id))
      .returning();
    if (!row) throw new Error('Card update returned no row');
    await emit(
      services,
      tx,
      'card.assigned',
      { kind: 'card', id },
      { projectId: row.projectId, assignee: next },
      actor,
    );
    return present(tx, row);
  });
}

/** Soft delete: the row keeps its number and repository reference. Deleting twice is a no-op. */
export async function deleteCard(
  services: CardServices,
  id: string,
  actor: Actor = owner,
): Promise<void> {
  await services.db.transaction(async (tx) => {
    const current = await lockCard(tx, id, { allowDeleted: true });
    if (current.deletedAt) return;
    const now = services.clock();
    await tx.update(cards).set({ deletedAt: now, updatedAt: now }).where(eq(cards.id, id));
    await emit(
      services,
      tx,
      'card.deleted',
      { kind: 'card', id },
      { projectId: current.projectId },
      actor,
    );
  });
}

/** Looks a card up by its id or its "KEY-number" reference; deleted cards read as missing. */
export async function getCard(services: Services, ref: string): Promise<Card> {
  const card = ref.startsWith(ID_PREFIXES.card)
    ? await getCardById(services.db, ref)
    : await getCardByRef(services.db, ref);
  if (!card) throw new NotFound('Card not found');
  return card;
}
