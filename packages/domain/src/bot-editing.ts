import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { bots, sql } from '@motes/db';
import {
  type BotConfigPatch,
  type BotDetail,
  type BotHistoryEntry,
  botConfigSchema,
  type CreateBotInput,
  createBotInputSchema,
} from '@motes/protocol';
import { parseDocument, stringify } from 'yaml';
import { BotFolderInvalid, loadBotFolder } from './bot-folder.js';
import { Conflict, NotFound, ValidationFailed } from './errors.js';
import type { Services } from './shared.js';
import { ensureSkillsDirectory, getBot, syncBots } from './skills.js';

const git = promisify(execFile);
// A repository without an identity would refuse to commit; this one only fills in the gap.
const IDENTITY = ['-c', 'user.name=Motes', '-c', 'user.email=motes@localhost'];

/** What a write needs besides the services: where the skills live, and whether the bot is busy. */
export type BotEditingServices = Services & {
  /** Runs arrive with P1-08; until then nothing is ever running. */
  botHasRunningRuns?: (id: string) => Promise<boolean>;
};

// Git cannot take two writers at once, and a write is validate, write, commit: one at a time.
const queues = new Map<string, Promise<unknown>>();
function exclusive<Result>(dir: string, work: () => Promise<Result>): Promise<Result> {
  const next = (queues.get(dir) ?? Promise.resolve()).then(work, work);
  queues.set(
    dir,
    next.catch(() => {}),
  );
  return next;
}

const runGit = (dir: string, args: string[]) => git('git', ['-C', dir, ...args]);

async function liveBot(services: Services, id: string) {
  const [row] = await services.db
    .select()
    .from(bots)
    .where(sql`${bots.id} = ${id} AND ${bots.removedAt} IS NULL`);
  if (!row) throw new NotFound('Bot not found');
  return row;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Runs the full folder validation on a copy that already has the change, so nothing on disk
 * changes when the result would be invalid. The copy keeps the folder's name, which the loader
 * compares with the slug. Hidden, so the watcher's scans ignore it.
 */
async function validated<Result>(
  dir: string,
  slug: string,
  prepare: (folder: string) => Promise<void>,
  after: (folder: string) => Promise<Result>,
): Promise<Result> {
  const staging = join(dir, '.staging', randomBytes(6).toString('hex'));
  const folder = join(staging, slug);
  try {
    await mkdir(staging, { recursive: true });
    await prepare(folder);
    try {
      await loadBotFolder(folder);
    } catch (error) {
      if (error instanceof BotFolderInvalid)
        throw new ValidationFailed('Invalid bot', error.issues);
      throw error;
    }
    return await after(folder);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Replaces a file atomically: a reader sees the old text or the new one, never half of it. */
async function replaceFile(path: string, text: string): Promise<void> {
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temp, text);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Commits only the given paths (the whole bot folder by default). Hand edits to other files in the
 * folder stay uncommitted, so they are neither swept into this commit nor lost with its revert.
 * A write that changed nothing makes no commit.
 */
async function commitFolder(
  dir: string,
  slug: string,
  message: string,
  paths: string[] = [`bots/${slug}`],
): Promise<boolean> {
  await runGit(dir, ['add', '-A', '--', ...paths]);
  const { stdout } = await runGit(dir, ['status', '--porcelain', '--', ...paths]);
  if (stdout.trim() === '') return false;
  await runGit(dir, [...IDENTITY, 'commit', '-q', '-m', message, '--', ...paths]);
  return true;
}

/** Whether anything under the bot's folder differs from the last commit, untracked files included. */
async function folderIsDirty(dir: string, slug: string): Promise<boolean> {
  const { stdout } = await runGit(dir, ['status', '--porcelain', '--', `bots/${slug}`]);
  return stdout.trim() !== '';
}

async function detail(services: Services, dir: string, id: string): Promise<BotDetail> {
  await syncBots(services, dir);
  return getBot(services, dir, id);
}

/** Changes SKILL.md. The file is validated as a whole, together with the rest of the folder. */
export function updateBotSkill(
  services: BotEditingServices,
  dir: string,
  id: string,
  markdown: string,
): Promise<BotDetail> {
  return exclusive(dir, async () => {
    const { slug } = await liveBot(services, id);
    const text = markdown.replaceAll('\r\n', '\n');
    const folder = join(dir, 'bots', slug);
    await validated(
      dir,
      slug,
      async (copy) => {
        await cp(folder, copy, { recursive: true });
        await writeFile(join(copy, 'SKILL.md'), text);
      },
      async () => {
        await replaceFile(join(folder, 'SKILL.md'), text);
      },
    );
    await commitFolder(dir, slug, `bot(${slug}): update behavior`, [`bots/${slug}/SKILL.md`]);
    return detail(services, dir, id);
  });
}

/**
 * Changes fields of bot.yaml, keeping the file's comments and the order of its keys. A field the
 * patch does not name is left alone.
 */
export function updateBotConfig(
  services: BotEditingServices,
  dir: string,
  id: string,
  patch: BotConfigPatch,
): Promise<BotDetail> {
  return exclusive(dir, async () => {
    const { slug } = await liveBot(services, id);
    const folder = join(dir, 'bots', slug);
    const current = await readFile(join(folder, 'bot.yaml'), 'utf8').catch(() => undefined);
    if (current === undefined)
      throw new ValidationFailed('Invalid bot', [
        { file: 'bot.yaml', path: '', message: 'The file is missing' },
      ]);
    const document = parseDocument(current);
    if (document.errors.length > 0)
      throw new ValidationFailed('Invalid bot', [
        { file: 'bot.yaml', path: '', message: `Invalid YAML: ${document.errors[0]?.message}` },
      ]);
    for (const [key, value] of Object.entries(patch))
      if (value !== undefined) document.set(key, value);
    const text = String(document);
    await validated(
      dir,
      slug,
      async (copy) => {
        await cp(folder, copy, { recursive: true });
        await writeFile(join(copy, 'bot.yaml'), text);
      },
      async () => {
        await replaceFile(join(folder, 'bot.yaml'), text);
      },
    );
    await commitFolder(dir, slug, `bot(${slug}): update config`, [`bots/${slug}/bot.yaml`]);
    return detail(services, dir, id);
  });
}

function templates(input: ReturnType<typeof createBotInputSchema.parse>) {
  const description =
    input.description ?? `${input.displayName}: describe when this bot should be used.`;
  const skill = `---\nname: ${input.slug}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${input.displayName}\n\nDescribe how this bot works: its role, how it works, what it must and must not do.\n`;
  const config = botConfigSchema.parse({
    slug: input.slug,
    displayName: input.displayName,
    kind: input.kind,
    engines: input.engines,
  });
  return { skill, config: stringify(config) };
}

/** Creates the folder from a template. An existing folder, or a name already in the index, is a conflict. */
export function createBot(
  services: BotEditingServices,
  dir: string,
  raw: CreateBotInput,
): Promise<BotDetail> {
  return exclusive(dir, async () => {
    const parsed = createBotInputSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationFailed('Invalid bot', parsed.error.issues);
    const input = parsed.data;
    await ensureSkillsDirectory(dir);
    const folder = join(dir, 'bots', input.slug);
    if (await exists(folder)) throw new Conflict(`A bot named ${input.slug} already exists`);
    const [taken] = await services.db
      .select({ id: bots.id })
      .from(bots)
      .where(sql`${bots.slug} = ${input.slug} AND ${bots.removedAt} IS NULL`);
    if (taken) throw new Conflict(`A bot named ${input.slug} already exists`);
    const { skill, config } = templates(input);
    await validated(
      dir,
      input.slug,
      async (copy) => {
        await mkdir(copy, { recursive: true });
        await writeFile(join(copy, 'SKILL.md'), skill);
        await writeFile(join(copy, 'bot.yaml'), config);
      },
      // The whole folder arrives in one rename, so a scan never sees half of a new bot.
      async (copy) => {
        await rename(copy, folder);
      },
    );
    await commitFolder(dir, input.slug, `bot(${input.slug}): create`);
    await syncBots(services, dir);
    const [row] = await services.db
      .select({ id: bots.id })
      .from(bots)
      .where(sql`${bots.slug} = ${input.slug} AND ${bots.removedAt} IS NULL`);
    if (!row) throw new Error('The new bot was not indexed');
    return getBot(services, dir, row.id);
  });
}

/** Deletes the folder and commits it, so it can be brought back from history. */
export function removeBot(services: BotEditingServices, dir: string, id: string): Promise<void> {
  return exclusive(dir, async () => {
    const { slug } = await liveBot(services, id);
    if (await services.botHasRunningRuns?.(id))
      throw new Conflict('The bot has running runs; wait for them or cancel them first');
    // The folder moves aside first, so a commit that fails puts everything back, hand edits too.
    const folder = join(dir, 'bots', slug);
    const aside = join(dir, '.staging', `removed-${randomBytes(6).toString('hex')}`);
    await mkdir(join(dir, '.staging'), { recursive: true });
    await rename(folder, aside);
    try {
      await commitFolder(dir, slug, `bot(${slug}): remove`);
    } catch (error) {
      await rename(aside, folder);
      await runGit(dir, ['reset', '-q', '--', `bots/${slug}`]).catch(() => {});
      throw error;
    }
    await rm(aside, { recursive: true, force: true });
    await syncBots(services, dir);
  });
}

/** The commits that touched the bot's folder, newest first. */
export async function botHistory(
  services: Services,
  dir: string,
  id: string,
  limit = 50,
): Promise<BotHistoryEntry[]> {
  const { slug } = await liveBot(services, id);
  const { stdout } = await runGit(dir, [
    'log',
    `--max-count=${limit}`,
    '--format=%H%x1f%an%x1f%aI%x1f%s',
    '--',
    `bots/${slug}`,
  ]).catch(() => ({ stdout: '' }));
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [commit = '', author = '', committedAt = '', message = ''] = line.split('\x1f');
      return { commit, author, committedAt, message };
    });
}

/**
 * Undoes one commit of the bot's history with a new commit. Only commits that touched this bot
 * alone can be reverted, creating the bot cannot be undone this way (delete it instead), and a
 * revert that no longer applies cleanly is refused and leaves the folder as it was.
 */
export function revertBot(
  services: BotEditingServices,
  dir: string,
  id: string,
  commit: string,
): Promise<BotDetail> {
  return exclusive(dir, async () => {
    const { slug } = await liveBot(services, id);
    const resolved = await runGit(dir, ['rev-parse', '--verify', '-q', `${commit}^{commit}`]).then(
      (result) => result.stdout.trim(),
      () => undefined,
    );
    if (!resolved) throw new NotFound('Commit not found');
    // Part of this bot's history, however old: the newest commit up to it that touched the folder
    // must be the commit itself, and it must be reachable from where the repository is now.
    const touched = await runGit(dir, ['rev-list', '--max-count=1', resolved, '--', `bots/${slug}`])
      .then((result) => result.stdout.trim())
      .catch(() => '');
    const reachable = await runGit(dir, ['merge-base', '--is-ancestor', resolved, 'HEAD']).then(
      () => true,
      () => false,
    );
    if (touched !== resolved || !reachable)
      throw new ValidationFailed("That commit is not part of this bot's history");
    // Rolling back below can only restore what was committed, so refuse while there is more.
    if (await folderIsDirty(dir, slug))
      throw new Conflict('The bot folder has uncommitted changes; commit or discard them first');
    const { stdout } = await runGit(dir, ['show', '--name-status', '--format=', resolved]);
    const changes = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'));
    if (changes.some((change) => !(change[1] ?? '').startsWith(`bots/${slug}/`)))
      throw new ValidationFailed(
        'That commit also changed other files and cannot be reverted here',
      );
    if (changes.some(([status, path]) => status === 'A' && path === `bots/${slug}/bot.yaml`))
      throw new ValidationFailed('Creating a bot cannot be reverted; delete the bot instead');
    // Undoes a half-done revert in this bot's folder only; other bots' files are never touched.
    const rollback = async () => {
      await runGit(dir, [
        'restore',
        '--source=HEAD',
        '--staged',
        '--worktree',
        '--',
        `bots/${slug}`,
      ]);
      await runGit(dir, ['clean', '-fdq', '--', `bots/${slug}`]);
    };
    try {
      await runGit(dir, [...IDENTITY, 'revert', '--no-commit', resolved]);
    } catch {
      await rollback();
      throw new Conflict('That change no longer applies cleanly to the current files');
    }
    // A revert that leaves an invalid folder would break the bot; keep the old files instead.
    try {
      await loadBotFolder(join(dir, 'bots', slug));
    } catch (error) {
      await rollback();
      if (error instanceof BotFolderInvalid)
        throw new ValidationFailed('Invalid bot', error.issues);
      throw error;
    }
    await commitFolder(dir, slug, `bot(${slug}): revert ${resolved.slice(0, 7)}`);
    return detail(services, dir, id);
  });
}
