import { type appendEvent, type Db, eq, projects, sql } from '@motes/db';
import {
  type CreateProjectInput,
  createProjectInputSchema,
  type EventEnvelope,
  type newId,
  type Project,
  projectSchema,
  renameProjectInputSchema,
} from '@motes/protocol';
import { Conflict, NotFound, ValidationFailed } from './errors.js';

type Services = { db: Db; clock: () => Date; newId: typeof newId; appendEvent: typeof appendEvent };
type Actor = EventEnvelope['actor'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const owner: Actor = { kind: 'owner' };

function toProject(row: typeof projects.$inferSelect): Project {
  return projectSchema.parse({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    ...(row.defaultRuntimeId ? { defaultRuntimeId: row.defaultRuntimeId } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
  });
}

function parseInput<Output>(
  parse: () => { success: true; data: Output } | { success: false; error: { issues: unknown } },
): Output {
  const result = parse();
  if (!result.success) throw new ValidationFailed('Invalid project', result.error.issues);
  return result.data;
}

function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return [error, cause].some(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'code' in candidate &&
      candidate.code === '23505',
  );
}

function emit(
  services: Services,
  tx: Tx,
  type: 'project.created' | 'project.renamed' | 'project.archived',
  project: { id: string },
  payload: Record<string, string>,
  actor: Actor,
) {
  return services.appendEvent(tx, {
    id: services.newId('event'),
    type,
    occurredAt: services.clock().toISOString(),
    actor,
    subject: { kind: 'project', id: project.id },
    payload,
  });
}

async function lockProject(tx: Tx, id: string) {
  const [row] = await tx.select().from(projects).where(eq(projects.id, id)).for('update');
  if (!row) throw new NotFound('Project not found');
  return row;
}

export async function createProject(
  services: Services,
  input: CreateProjectInput,
  actor: Actor = owner,
): Promise<Project> {
  const data = parseInput(() => createProjectInputSchema.safeParse(input));
  try {
    return await services.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(projects)
        .values({
          id: services.newId('project'),
          key: data.key,
          name: data.name,
          description: data.description,
          defaultRuntimeId: data.defaultRuntimeId ?? null,
          createdAt: services.clock(),
        })
        .returning();
      if (!row) throw new Error('Project insertion returned no row');
      await emit(services, tx, 'project.created', row, { key: row.key, name: row.name }, actor);
      return toProject(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new Conflict(`Project key ${data.key} is already in use`);
    throw error;
  }
}

export async function renameProject(
  services: Services,
  id: string,
  name: string,
  actor: Actor = owner,
): Promise<Project> {
  const next = parseInput(() => renameProjectInputSchema.safeParse(name));
  return services.db.transaction(async (tx) => {
    const current = await lockProject(tx, id);
    if (current.name === next) return toProject(current);
    const [row] = await tx
      .update(projects)
      .set({ name: next })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new Error('Project update returned no row');
    await emit(services, tx, 'project.renamed', row, { name: row.name }, actor);
    return toProject(row);
  });
}

export async function archiveProject(
  services: Services,
  id: string,
  actor: Actor = owner,
): Promise<Project> {
  return services.db.transaction(async (tx) => {
    const current = await lockProject(tx, id);
    if (current.archivedAt) return toProject(current);
    const [row] = await tx
      .update(projects)
      .set({ archivedAt: services.clock() })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new Error('Project update returned no row');
    await emit(services, tx, 'project.archived', row, {}, actor);
    return toProject(row);
  });
}

export async function listProjects(
  services: Services,
  options: { includeArchived?: boolean } = {},
): Promise<Project[]> {
  const rows = await services.db
    .select()
    .from(projects)
    .where(options.includeArchived ? undefined : sql`${projects.archivedAt} IS NULL`)
    .orderBy(sql`${projects.createdAt}, ${projects.id}`);
  return rows.map(toProject);
}
