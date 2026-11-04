import { execFile } from 'node:child_process';
import { type FSWatcher, watch } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { bots, eq, sql } from '@motes/db';
import { type BotDetail, type BotSummary, botSummarySchema } from '@motes/protocol';
import { type BotFolder, BotFolderInvalid, loadBotFolder } from './bot-folder.js';
import { NotFound } from './errors.js';
import { emit, type Services, type Tx } from './shared.js';

const run = promisify(execFile);
const system = { kind: 'system' } as const;

type Row = typeof bots.$inferSelect;

function toSummary(row: Row): BotSummary {
  return botSummarySchema.parse({
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    kind: row.kind,
    engines: row.engines,
    enabled: row.enabled,
    skillDigest: row.skillDigest,
    ...(row.loadError ? { loadError: row.loadError } : {}),
  });
}

/**
 * Creates bots/ and shared/ and makes the directory a git repository, so every behavior change
 * has history. A directory already inside a repository is left as it is.
 */
export async function ensureSkillsDirectory(dir: string): Promise<void> {
  await mkdir(join(dir, 'bots'), { recursive: true });
  await mkdir(join(dir, 'shared'), { recursive: true });
  const inside = await run('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree']).then(
    () => true,
    () => false,
  );
  if (!inside) await run('git', ['-C', dir, 'init', '-q']);
}

type Found = { slug: string; folder: BotFolder } | { slug: string; error: string };

async function readFolders(dir: string): Promise<Found[]> {
  const entries = await readdir(join(dir, 'bots'), { withFileTypes: true });
  const found: Found[] = [];
  for (const entry of entries) {
    // Links, files and hidden entries are not bot folders.
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      found.push({
        slug: entry.name,
        folder: await loadBotFolder(join(dir, 'bots', entry.name)),
      });
    } catch (error) {
      if (!(error instanceof BotFolderInvalid)) throw error;
      found.push({ slug: entry.name, error: error.message });
    }
  }
  return found;
}

const sameEngines = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

async function apply(services: Services, tx: Tx, found: Found[]): Promise<void> {
  // One writer at a time, so two overlapping scans cannot both create the same bot.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(1984020305)`);
  const rows = new Map((await tx.select().from(bots)).map((row) => [row.slug, row]));
  const now = services.clock();
  const announce = (type: 'bot.created' | 'bot.updated' | 'bot.removed', row: Row) =>
    emit(services, tx, type, { kind: 'bot', id: row.id }, { slug: row.slug }, system);

  for (const item of found) {
    const row = rows.get(item.slug);
    if ('error' in item) {
      // A folder that was never valid has no index row; one that broke keeps its last valid fields.
      if (!row || row.removedAt || row.loadError === item.error) continue;
      const [updated] = await tx
        .update(bots)
        .set({ loadError: item.error, updatedAt: now })
        .where(eq(bots.id, row.id))
        .returning();
      if (updated) await announce('bot.updated', updated);
      continue;
    }
    const { config, digest } = item.folder;
    const next = {
      displayName: config.displayName,
      kind: config.kind,
      engines: config.engines,
      enabled: config.enabled,
      skillDigest: digest,
      loadError: null,
    };
    if (!row) {
      const [created] = await tx
        .insert(bots)
        .values({
          id: services.newId('bot'),
          slug: item.slug,
          ...next,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (created) await announce('bot.created', created);
      continue;
    }
    const unchanged =
      !row.removedAt &&
      row.displayName === next.displayName &&
      row.kind === next.kind &&
      row.enabled === next.enabled &&
      row.skillDigest === next.skillDigest &&
      row.loadError === null &&
      sameEngines(row.engines, next.engines);
    if (unchanged) continue;
    const [updated] = await tx
      .update(bots)
      .set({ ...next, removedAt: null, updatedAt: now })
      .where(eq(bots.id, row.id))
      .returning();
    // A bot whose folder came back is a new arrival for everyone listening.
    if (updated) await announce(row.removedAt ? 'bot.created' : 'bot.updated', updated);
  }

  const present = new Set(found.map((item) => item.slug));
  for (const row of rows.values()) {
    if (row.removedAt || present.has(row.slug)) continue;
    const [removed] = await tx
      .update(bots)
      .set({ removedAt: now, updatedAt: now })
      .where(eq(bots.id, row.id))
      .returning();
    if (removed) await announce('bot.removed', removed);
  }
}

/**
 * Brings the bot index in line with the folders under `<dir>/bots`: new folders are indexed, edits
 * update their row, deleted folders are marked removed, and a folder with errors keeps its last
 * valid version with the error attached. Running it again changes nothing. Throws when the
 * directory cannot be read, so a vanished disk never removes every bot.
 */
export async function syncBots(services: Services, dir: string): Promise<void> {
  const found = await readFolders(dir);
  await services.db.transaction((tx) => apply(services, tx, found));
}

export type SkillsWatcher = {
  /** Resolves once the first scan is done (or has failed and been reported). */
  ready: Promise<void>;
  stop(): Promise<void>;
};

/**
 * Scans now and again after every change under the directory. Changes are debounced and scans
 * never overlap; failures go to `onError` because a watcher must not take the server down.
 */
export function watchSkills(
  services: Services,
  dir: string,
  options: { debounceMs?: number; onError?: (error: unknown) => void } = {},
): SkillsWatcher {
  const debounceMs = options.debounceMs ?? 250;
  const onError = options.onError ?? (() => {});
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let queue: Promise<void> = Promise.resolve();
  const scan = () => {
    queue = queue
      .then(() => (stopped ? undefined : syncBots(services, dir)))
      .catch((error: unknown) => onError(error));
    return queue;
  };
  let watcher: FSWatcher | undefined;
  try {
    // Started before the first scan so a change made in between is not missed.
    watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (stopped || (filename && /(^|[\\/])\.git([\\/]|$)/.test(filename))) return;
      clearTimeout(timer);
      timer = setTimeout(scan, debounceMs);
    });
    watcher.on('error', onError);
  } catch (error) {
    onError(error);
  }
  return {
    ready: watcher ? scan() : Promise.resolve(),
    async stop() {
      stopped = true;
      clearTimeout(timer);
      watcher?.close();
      await queue;
    },
  };
}

export async function listBots(services: Services): Promise<BotSummary[]> {
  const rows = await services.db
    .select()
    .from(bots)
    .where(sql`${bots.removedAt} IS NULL`)
    .orderBy(bots.slug);
  return rows.map(toSummary);
}

/** The index row plus the config and skill read from the folder now; null while it is broken. */
export async function getBot(services: Services, dir: string, id: string): Promise<BotDetail> {
  const [row] = await services.db
    .select()
    .from(bots)
    .where(sql`${bots.id} = ${id} AND ${bots.removedAt} IS NULL`);
  if (!row) throw new NotFound('Bot not found');
  const path = join(dir, 'bots', row.slug);
  // The text is read on its own so a broken folder can still be opened and fixed in an editor.
  const skillSource = await readFile(join(path, 'SKILL.md'), 'utf8').catch(() => null);
  try {
    const folder = await loadBotFolder(path);
    return {
      ...toSummary(row),
      config: folder.config,
      skill: folder.skill,
      skillSource,
      references: folder.references,
    };
  } catch (error) {
    if (!(error instanceof BotFolderInvalid)) throw error;
    return { ...toSummary(row), config: null, skill: null, skillSource, references: [] };
  }
}
