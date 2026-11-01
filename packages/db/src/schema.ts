import type { EventEnvelope } from '@motes/protocol';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const events = pgTable('events', {
  seq: bigserial({ mode: 'bigint' }).primaryKey(),
  id: text().$type<EventEnvelope['id']>().notNull().unique(),
  type: text().notNull(),
  occurredAt: timestamp('occurred_at', {
    withTimezone: true,
    mode: 'date',
    precision: 3,
  }).notNull(),
  actor: jsonb().$type<EventEnvelope['actor']>().notNull(),
  subjectKind: text('subject_kind').notNull(),
  subjectId: text('subject_id').notNull(),
  payload: jsonb().$type<EventEnvelope['payload']>().notNull(),
});

export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    kind: text({ enum: ['client', 'daemon'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, precision: 3 }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, precision: 3 }),
  },
  (table) => [
    check('device_kind_check', sql`${table.kind} IN ('client', 'daemon')`),
    check('device_hash_check', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('device_name_check', sql`length(trim(${table.name})) > 0`),
  ],
);

export const pairingState = pgTable(
  'pairing_state',
  {
    id: integer().primaryKey(),
    codeHash: text('code_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }),
    failures: integer().notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, precision: 3 }),
  },
  (table) => [
    check('pairing_singleton_check', sql`${table.id} = 1`),
    check('pairing_failures_check', sql`${table.failures} BETWEEN 0 AND 4`),
    check(
      'pairing_code_check',
      sql`(${table.codeHash} IS NULL AND ${table.expiresAt} IS NULL) OR (${table.codeHash} IS NOT NULL AND ${table.codeHash} ~ '^[0-9a-f]{64}$' AND ${table.expiresAt} IS NOT NULL)`,
    ),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: text().primaryKey(),
    // Archived projects keep their key reserved.
    key: text().notNull().unique(),
    name: text().notNull(),
    description: text().notNull(),
    // No foreign key yet: runtimes arrive in a later epic.
    defaultRuntimeId: text('default_runtime_id'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, precision: 3 }),
  },
  (table) => [
    check('project_key_check', sql`${table.key} ~ '^[A-Z]{2,6}$'`),
    check('project_name_check', sql`length(trim(${table.name})) > 0`),
  ],
);

// Dependents are removed by application code in a transaction; there are no cascading deletes.
export const repositories = pgTable(
  'repositories',
  {
    id: text().primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text().notNull(),
    remoteUrl: text('remote_url').notNull(),
    defaultBranch: text('default_branch').notNull(),
    isPrimary: boolean('is_primary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull(),
  },
  (table) => [
    // At most one primary per project; the domain keeps one whenever a repository exists.
    uniqueIndex('repositories_primary_idx').on(table.projectId).where(sql`${table.isPrimary}`),
    check('repository_name_check', sql`length(trim(${table.name})) > 0`),
  ],
);

export const repositoryPaths = pgTable(
  'repository_paths',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    // No foreign key yet: runtimes arrive in a later epic.
    runtimeId: text('runtime_id').notNull(),
    localPath: text('local_path').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repositoryId, table.runtimeId] }),
    check('repository_path_check', sql`${table.localPath} ~ '^/'`),
  ],
);
