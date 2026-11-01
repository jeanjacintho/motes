import { cardLabelIds, cardLabels, cards, eq, labels, projects, sql } from '@motes/db';
import {
  type Card,
  type CreateLabelInput,
  createLabelInputSchema,
  type Label,
  labelSchema,
  type UpdateLabelInput,
  updateLabelInputSchema,
} from '@motes/protocol';
import { lockCard, present } from './cards.js';
import { Conflict, NotFound, ValidationFailed } from './errors.js';
import { type Actor, emit, owner, parseInput, type Services, type Tx } from './shared.js';

function toLabel(row: typeof labels.$inferSelect): Label {
  return labelSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    color: row.color,
  });
}

async function lockProject(tx: Tx, projectId: string) {
  const [row] = await tx.select().from(projects).where(eq(projects.id, projectId)).for('update');
  if (!row) throw new NotFound('Project not found');
}

// Project lock first, as everywhere, then the label row, which may have vanished meanwhile.
async function lockLabel(tx: Tx, id: string) {
  const [peek] = await tx
    .select({ projectId: labels.projectId })
    .from(labels)
    .where(eq(labels.id, id));
  if (!peek) throw new NotFound('Label not found');
  await lockProject(tx, peek.projectId);
  const [row] = await tx.select().from(labels).where(eq(labels.id, id)).for('update');
  if (!row) throw new NotFound('Label not found');
  return row;
}

async function assertNameFree(tx: Tx, projectId: string, name: string, exceptId?: string) {
  const [taken] = await tx
    .select({ id: labels.id })
    .from(labels)
    .where(
      sql`${labels.projectId} = ${projectId} AND lower(${labels.name}) = lower(${name})${
        exceptId ? sql` AND ${labels.id} <> ${exceptId}` : sql``
      }`,
    );
  if (taken) throw new Conflict(`Label ${name} already exists in this project`);
}

export async function createLabel(
  services: Services,
  projectId: string,
  input: CreateLabelInput,
  actor: Actor = owner,
): Promise<Label> {
  const data = parseInput('label', () => createLabelInputSchema.safeParse(input));
  return services.db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    await assertNameFree(tx, projectId, data.name);
    const [row] = await tx
      .insert(labels)
      .values({ id: services.newId('label'), projectId, ...data, createdAt: services.clock() })
      .returning();
    if (!row) throw new Error('Label insertion returned no row');
    await emit(services, tx, 'label.created', { kind: 'label', id: row.id }, { projectId }, actor);
    return toLabel(row);
  });
}

/** Renames and recolors; cards reference labels by id, so none of them needs touching. */
export async function updateLabel(
  services: Services,
  id: string,
  input: UpdateLabelInput,
  actor: Actor = owner,
): Promise<Label> {
  const patch = parseInput('label', () => updateLabelInputSchema.safeParse(input));
  return services.db.transaction(async (tx) => {
    const current = await lockLabel(tx, id);
    const name = patch.name ?? current.name;
    const color = patch.color ?? current.color;
    if (name === current.name && color === current.color) return toLabel(current);
    if (name.toLowerCase() !== current.name.toLowerCase())
      await assertNameFree(tx, current.projectId, name, id);
    const [row] = await tx.update(labels).set({ name, color }).where(eq(labels.id, id)).returning();
    if (!row) throw new Error('Label update returned no row');
    await emit(
      services,
      tx,
      'label.updated',
      { kind: 'label', id },
      { projectId: row.projectId },
      actor,
    );
    return toLabel(row);
  });
}

export async function listLabels(services: Services, projectId: string): Promise<Label[]> {
  const rows = await services.db
    .select()
    .from(labels)
    .where(eq(labels.projectId, projectId))
    .orderBy(sql`lower(${labels.name}), ${labels.id}`);
  return rows.map(toLabel);
}

/**
 * Removes the label from every card and then deletes it, all in one transaction. Each live card
 * that lost it announces its new label set; the label's own event comes last.
 */
export async function deleteLabel(
  services: Services,
  id: string,
  actor: Actor = owner,
): Promise<void> {
  await services.db.transaction(async (tx) => {
    const label = await lockLabel(tx, id);
    const affected = await tx
      .select({ id: cards.id, deletedAt: cards.deletedAt })
      .from(cardLabels)
      .innerJoin(cards, sql`${cardLabels.cardId} = ${cards.id}`)
      .where(eq(cardLabels.labelId, id))
      .orderBy(cards.id);
    await tx.delete(cardLabels).where(eq(cardLabels.labelId, id));
    await tx.delete(labels).where(eq(labels.id, id));
    for (const card of affected) {
      if (card.deletedAt) continue;
      await emit(
        services,
        tx,
        'card.labels_changed',
        { kind: 'card', id: card.id },
        { projectId: label.projectId, labelIds: await cardLabelIds(tx, card.id) },
        actor,
      );
    }
    await emit(
      services,
      tx,
      'label.deleted',
      { kind: 'label', id },
      { projectId: label.projectId },
      actor,
    );
  });
}

async function changeCardLabel(
  services: Services,
  cardId: string,
  labelId: string,
  attach: boolean,
  actor: Actor,
): Promise<Card> {
  return services.db.transaction(async (tx) => {
    const card = await lockCard(tx, cardId);
    const [label] = await tx.select().from(labels).where(eq(labels.id, labelId));
    if (!label) throw new NotFound('Label not found');
    if (label.projectId !== card.projectId)
      throw new ValidationFailed('Label does not belong to the card project');
    const link = sql`${cardLabels.cardId} = ${cardId} AND ${cardLabels.labelId} = ${labelId}`;
    const [existing] = await tx.select().from(cardLabels).where(link);
    if (Boolean(existing) === attach) return present(tx, card);
    if (attach) await tx.insert(cardLabels).values({ cardId, labelId });
    else await tx.delete(cardLabels).where(link);
    const [row] = await tx
      .update(cards)
      .set({ updatedAt: services.clock() })
      .where(eq(cards.id, cardId))
      .returning();
    if (!row) throw new Error('Card update returned no row');
    const updated = await present(tx, row);
    await emit(
      services,
      tx,
      'card.labels_changed',
      { kind: 'card', id: cardId },
      { projectId: row.projectId, labelIds: updated.labels },
      actor,
    );
    return updated;
  });
}

export const attachLabel = (
  services: Services,
  cardId: string,
  labelId: string,
  actor: Actor = owner,
) => changeCardLabel(services, cardId, labelId, true, actor);

export const detachLabel = (
  services: Services,
  cardId: string,
  labelId: string,
  actor: Actor = owner,
) => changeCardLabel(services, cardId, labelId, false, actor);
