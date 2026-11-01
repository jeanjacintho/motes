import {
  BOT_KINDS,
  CARD_PRIORITIES,
  CARD_STATUSES,
  type EventEnvelope,
} from '@motes/protocol';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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

// Allocating a number upserts this row, which holds its lock until the transaction ends.
export const projectCounters = pgTable(
  'project_counters',
  {
    projectId: text('project_id')
      .primaryKey()
      .references(() => projects.id),
    lastNumber: integer('last_number').notNull(),
  },
  (table) => [check('project_counter_check', sql`${table.lastNumber} >= 0`)],
);

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const cards = pgTable(
  'cards',
  {
    id: text().primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    number: integer().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    assigneeType: text('assignee_type'),
    assigneeId: text('assignee_id'),
    repositoryId: text('repository_id').references(() => repositories.id),
    createdByType: text('created_by_type').notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull(),
    // Fractional key ordering the card inside its status column; compare with COLLATE "C".
    position: text().notNull(),
    // Soft delete: the row keeps its number and repository reference.
    deletedAt: timestamp('deleted_at', { withTimezone: true, precision: 3 }),
  },
  (table) => [
    unique('cards_project_number_key').on(table.projectId, table.number),
    uniqueIndex('cards_column_position_idx')
      .on(table.projectId, table.status, table.position)
      .where(sql`${table.deletedAt} IS NULL`),
    check('card_position_check', sql`${table.position} ~ '^[0-9A-Za-z]*[1-9A-Za-z]$'`),
    check('card_number_check', sql`${table.number} > 0`),
    check('card_title_check', sql`length(trim(${table.title})) > 0`),
    check('card_status_check', sql`${table.status} IN (${sqlList(CARD_STATUSES)})`),
    check('card_priority_check', sql`${table.priority} IN (${sqlList(CARD_PRIORITIES)})`),
    check(
      'card_assignee_check',
      sql`(${table.assigneeType} IS NULL AND ${table.assigneeId} IS NULL) OR (${table.assigneeType} IS NOT NULL AND ${table.assigneeType} IN ('owner', 'bot') AND ${table.assigneeId} IS NOT NULL AND length(trim(${table.assigneeId})) > 0)`,
    ),
    check('card_creator_check', sql`${table.createdByType} IN ('owner', 'bot', 'system')`),
  ],
);

export const labels = pgTable(
  'labels',
  {
    id: text().primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text().notNull(),
    color: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull(),
  },
  (table) => [
    // "Bug" and "bug" would read as the same label, so names are unique ignoring case.
    uniqueIndex('labels_project_name_idx').on(table.projectId, sql`lower(${table.name})`),
    check('label_name_check', sql`length(trim(${table.name})) > 0`),
    check('label_color_check', sql`${table.color} ~ '^#[0-9a-f]{6}$'`),
  ],
);

export const cardLabels = pgTable(
  'card_labels',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id),
  },
  (table) => [primaryKey({ columns: [table.cardId, table.labelId] })],
);

export const comments = pgTable(
  'comments',
  {
    id: text().primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),
    authorType: text('author_type').notNull(),
    authorId: text('author_id').notNull(),
    body: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true, precision: 3 }),
    // Soft delete: the row stays so the timeline can still account for it.
    deletedAt: timestamp('deleted_at', { withTimezone: true, precision: 3 }),
  },
  (table) => [
    index('comments_card_idx').on(table.cardId, table.createdAt, table.id),
    check('comment_author_check', sql`${table.authorType} IN ('owner', 'bot')`),
    check('comment_author_id_check', sql`length(trim(${table.authorId})) > 0`),
    check('comment_body_check', sql`length(trim(${table.body})) > 0`),
  ],
);

// Written from events by a projector. The primary key is the event id, so replay is idempotent.
export const cardActivity = pgTable(
  'card_activity',
  {
    id: text().primaryKey(),
    seq: bigint({ mode: 'bigint' }).notNull(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),
    type: text().notNull(),
    actor: jsonb().$type<{ kind: string; id?: string | undefined }>().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, precision: 3 }).notNull(),
  },
  (table) => [index('card_activity_card_idx').on(table.cardId, table.seq)],
);

// An index of the bot folders on disk, which stay the source of truth for behavior. Rows are never
// deleted: a bot whose folder vanished is marked removed, so ids stay valid for cards and runs.
export const bots = pgTable(
  'bots',
  {
    id: text().primaryKey(),
    slug: text().notNull().unique(),
    displayName: text('display_name').notNull(),
    kind: text().notNull(),
    engines: jsonb().$type<string[]>().notNull(),
    enabled: boolean().notNull(),
    skillDigest: text('skill_digest').notNull(),
    // Set while the folder is invalid; the other columns then hold the last valid version.
    loadError: text('load_error'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true, precision: 3 }),
  },
  (table) => [
    check('bot_kind_check', sql`${table.kind} IN (${sqlList(BOT_KINDS)})`),
    check('bot_slug_check', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('bot_digest_check', sql`${table.skillDigest} ~ '^[0-9a-f]{64}$'`),
    check(
      'bot_engines_check',
      sql`jsonb_typeof(${table.engines}) = 'array' AND jsonb_array_length(${table.engines}) > 0`,
    ),
  ],
);
