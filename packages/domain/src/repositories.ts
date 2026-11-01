import { eq, projects, repositories, repositoryPaths, sql } from '@motes/db';
import {
  type AddRepositoryInput,
  addRepositoryInputSchema,
  type Repository,
  type RepositoryPath,
  repositoryPathSchema,
  repositorySchema,
  type UpdateRepositoryInput,
  updateRepositoryInputSchema,
} from '@motes/protocol';
import { Conflict, NotFound } from './errors.js';
import { type Actor, emit, owner, parseInput, type Services, type Tx } from './shared.js';

/** `repositoryInUse` lets the card module veto removal once cards reference repositories. */
export type RepositoryServices = Services & {
  repositoryInUse?: (tx: Tx, repositoryId: string) => Promise<boolean>;
};

function toRepository(row: typeof repositories.$inferSelect): Repository {
  return repositorySchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    remoteUrl: row.remoteUrl,
    defaultBranch: row.defaultBranch,
    isPrimary: row.isPrimary,
  });
}

// Serializes changes within a project so exactly one repository stays primary.
async function lockProject(tx: Tx, projectId: string) {
  const [row] = await tx.select().from(projects).where(eq(projects.id, projectId)).for('update');
  if (!row) throw new NotFound('Project not found');
}

async function findRepository(tx: Tx, id: string, lock: boolean) {
  const query = tx.select().from(repositories).where(eq(repositories.id, id));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new NotFound('Repository not found');
  return row;
}

// Locks the project first, then re-reads the repository, which may have vanished meanwhile.
async function lockedRepository(tx: Tx, id: string) {
  const { projectId } = await findRepository(tx, id, false);
  await lockProject(tx, projectId);
  return findRepository(tx, id, true);
}

const repositoryEvent = (
  services: Services,
  tx: Tx,
  type: 'repository.updated' | 'repository.removed',
  row: { id: string; projectId: string },
  actor: Actor,
) =>
  emit(services, tx, type, { kind: 'repository', id: row.id }, { projectId: row.projectId }, actor);

export async function addRepository(
  services: Services,
  projectId: string,
  input: AddRepositoryInput,
  actor: Actor = owner,
): Promise<Repository> {
  const data = parseInput('repository', () => addRepositoryInputSchema.safeParse(input));
  return services.db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    const [existing] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(repositories)
      .where(eq(repositories.projectId, projectId));
    const [row] = await tx
      .insert(repositories)
      .values({
        id: services.newId('repository'),
        projectId,
        ...data,
        isPrimary: existing?.count === 0,
        createdAt: services.clock(),
      })
      .returning();
    if (!row) throw new Error('Repository insertion returned no row');
    await emit(
      services,
      tx,
      'repository.added',
      { kind: 'repository', id: row.id },
      { projectId, name: row.name },
      actor,
    );
    return toRepository(row);
  });
}

export async function updateRepository(
  services: Services,
  id: string,
  patch: UpdateRepositoryInput,
  actor: Actor = owner,
): Promise<Repository> {
  const data = parseInput('repository', () => updateRepositoryInputSchema.safeParse(patch));
  return services.db.transaction(async (tx) => {
    const current = await findRepository(tx, id, true);
    const changed = Object.entries(data).some(
      ([key, value]) => current[key as keyof typeof current] !== value,
    );
    if (!changed) return toRepository(current);
    const [row] = await tx
      .update(repositories)
      .set(data)
      .where(eq(repositories.id, id))
      .returning();
    if (!row) throw new Error('Repository update returned no row');
    await repositoryEvent(services, tx, 'repository.updated', row, actor);
    return toRepository(row);
  });
}

export async function setPrimaryRepository(
  services: Services,
  id: string,
  actor: Actor = owner,
): Promise<Repository> {
  return services.db.transaction(async (tx) => {
    const target = await lockedRepository(tx, id);
    if (target.isPrimary) return toRepository(target);
    const [previous] = await tx
      .update(repositories)
      .set({ isPrimary: false })
      .where(sql`${repositories.projectId} = ${target.projectId} AND ${repositories.isPrimary}`)
      .returning();
    const [row] = await tx
      .update(repositories)
      .set({ isPrimary: true })
      .where(eq(repositories.id, id))
      .returning();
    if (!row) throw new Error('Repository update returned no row');
    if (previous) await repositoryEvent(services, tx, 'repository.updated', previous, actor);
    await repositoryEvent(services, tx, 'repository.updated', row, actor);
    return toRepository(row);
  });
}

export async function removeRepository(
  services: RepositoryServices,
  id: string,
  actor: Actor = owner,
): Promise<void> {
  await services.db.transaction(async (tx) => {
    const target = await lockedRepository(tx, id);
    if (await services.repositoryInUse?.(tx, id))
      throw new Conflict('Repository is used by open cards');
    await tx.delete(repositoryPaths).where(eq(repositoryPaths.repositoryId, id));
    await tx.delete(repositories).where(eq(repositories.id, id));
    await repositoryEvent(services, tx, 'repository.removed', target, actor);
    if (!target.isPrimary) return;
    const [next] = await tx
      .select()
      .from(repositories)
      .where(eq(repositories.projectId, target.projectId))
      .orderBy(sql`${repositories.createdAt}, ${repositories.id}`)
      .limit(1);
    if (!next) return;
    await tx.update(repositories).set({ isPrimary: true }).where(eq(repositories.id, next.id));
    await repositoryEvent(services, tx, 'repository.updated', next, actor);
  });
}

export async function setRepositoryPath(
  services: Services,
  repositoryId: string,
  runtimeId: string,
  localPath: string,
  actor: Actor = owner,
): Promise<RepositoryPath> {
  const path = parseInput('repository path', () =>
    repositoryPathSchema.safeParse({ repositoryId, runtimeId, localPath }),
  );
  return services.db.transaction(async (tx) => {
    const repository = await findRepository(tx, repositoryId, true);
    const [current] = await tx
      .select()
      .from(repositoryPaths)
      .where(
        sql`${repositoryPaths.repositoryId} = ${repositoryId} AND ${repositoryPaths.runtimeId} = ${runtimeId}`,
      );
    if (current?.localPath === path.localPath) return path;
    await tx
      .insert(repositoryPaths)
      .values(path)
      .onConflictDoUpdate({
        target: [repositoryPaths.repositoryId, repositoryPaths.runtimeId],
        set: { localPath: path.localPath },
      });
    await emit(
      services,
      tx,
      'repository.path_set',
      { kind: 'repository', id: repositoryId },
      { projectId: repository.projectId, runtimeId },
      actor,
    );
    return path;
  });
}

export async function listRepositories(
  services: Services,
  projectId: string,
): Promise<Repository[]> {
  const rows = await services.db
    .select()
    .from(repositories)
    .where(eq(repositories.projectId, projectId))
    .orderBy(sql`${repositories.createdAt}, ${repositories.id}`);
  return rows.map(toRepository);
}

export async function listRepositoryPaths(
  services: Services,
  repositoryId: string,
): Promise<RepositoryPath[]> {
  const rows = await services.db
    .select()
    .from(repositoryPaths)
    .where(eq(repositoryPaths.repositoryId, repositoryId))
    .orderBy(repositoryPaths.runtimeId);
  return rows.map((row) => repositoryPathSchema.parse(row));
}
