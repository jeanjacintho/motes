import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  botHistory,
  createBot,
  removeBot,
  revertBot,
  updateBotConfig,
  updateBotSkill,
} from './bot-editing.js';
import { Conflict, NotFound, ValidationFailed } from './errors.js';
import { ensureSkillsDirectory, getBot, listBots, syncBots } from './skills.js';

const testDb = withTestDb();

const services = (extra: object = {}) => ({
  db: testDb.db,
  appendEvent,
  clock: () => new Date('2026-10-31T10:00:00.000Z'),
  newId,
  ...extra,
});

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'motes-edit-'));
});
afterAll(() => rm(root, { recursive: true, force: true }));

let counter = 0;
async function freshDir() {
  const dir = join(root, String(counter++));
  await ensureSkillsDirectory(dir);
  return dir;
}

let slugs = 0;
const slug = (label: string) => `${label}-${Date.now().toString(36)}-${slugs++}`;

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const messages = (dir: string) => git(dir, 'log', '--format=%s').split('\n').filter(Boolean);
const skillText = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: Does the ${name} work.\n---\n${body}\n`;

async function newBot(dir: string, name = slug('bot')) {
  const bot = await createBot(services(), dir, { slug: name, displayName: 'Meu Bot', kind: 'dev' });
  return { bot, name };
}

describe('createBot', () => {
  it('makes the folder from a template, commits it and indexes the bot', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    expect(bot).toMatchObject({
      slug: name,
      displayName: 'Meu Bot',
      kind: 'dev',
      engines: ['claude'],
      enabled: true,
    });
    expect(bot.skill?.frontMatter.name).toBe(name);
    expect(await readFile(join(dir, 'bots', name, 'bot.yaml'), 'utf8')).toContain(`slug: ${name}`);
    expect(messages(dir)).toEqual([`bot(${name}): create`]);
    expect((await listBots(services())).some((item) => item.slug === name)).toBe(true);
    // Nothing is left behind in the staging area.
    expect(existsSync(join(dir, '.staging')) ? readdirSync(join(dir, '.staging')) : []).toEqual([]);
  });

  it('refuses a name that is taken and a slug or kind that is invalid, changing nothing', async () => {
    const dir = await freshDir();
    const { name } = await newBot(dir);
    await expect(
      createBot(services(), dir, { slug: name, displayName: 'Outro', kind: 'office' }),
    ).rejects.toBeInstanceOf(Conflict);
    for (const input of [
      { slug: 'Bad Slug', displayName: 'x', kind: 'dev' },
      { slug: slug('ok'), displayName: '', kind: 'dev' },
      { slug: slug('ok'), displayName: 'x', kind: 'nope' },
      { slug: slug('ok'), displayName: 'x', kind: 'dev', engines: [] },
    ])
      await expect(createBot(services(), dir, input as never)).rejects.toBeInstanceOf(
        ValidationFailed,
      );
    expect(messages(dir)).toHaveLength(1);
    expect(readdirSync(join(dir, 'bots'))).toEqual([name]);
  });
});

describe('updateBotSkill', () => {
  it('writes the file, commits it and the index follows', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    const updated = await updateBotSkill(
      services(),
      dir,
      bot.id,
      skillText(name, '# Novo comportamento'),
    );
    expect(updated.skill?.body).toContain('Novo comportamento');
    expect(updated.skillDigest).not.toBe(bot.skillDigest);
    expect(await readFile(join(dir, 'bots', name, 'SKILL.md'), 'utf8')).toContain(
      'Novo comportamento',
    );
    expect(messages(dir)[0]).toBe(`bot(${name}): update behavior`);
  });

  it('changes nothing on disk or in history when the text is invalid', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    const before = await readFile(join(dir, 'bots', name, 'SKILL.md'), 'utf8');
    for (const text of [
      'sem front matter',
      skillText('outro-nome', 'x'),
      '---\nname: x\n---\nsem descrição',
      `---\nname: ${name}\ndescription: ok\nextra: nope\n---\nx`,
    ])
      await expect(updateBotSkill(services(), dir, bot.id, text)).rejects.toBeInstanceOf(
        ValidationFailed,
      );
    expect(await readFile(join(dir, 'bots', name, 'SKILL.md'), 'utf8')).toBe(before);
    expect(messages(dir)).toHaveLength(1);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect((await getBot(services(), dir, bot.id)).loadError).toBeUndefined();
  });

  it('reports the issue with the file and the field it is about', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    const failure = await updateBotSkill(
      services(),
      dir,
      bot.id,
      `---\nname: ${name}\ndescription: ""\n---\nx`,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ValidationFailed);
    const issues = (failure as ValidationFailed).details as { file: string; path: string }[];
    expect(issues).toEqual([expect.objectContaining({ file: 'SKILL.md', path: 'description' })]);
  });

  it('makes no commit when the text is the same as the file', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    const current = await readFile(join(dir, 'bots', name, 'SKILL.md'), 'utf8');
    await updateBotSkill(services(), dir, bot.id, current);
    expect(messages(dir)).toHaveLength(1);
  });

  it('can repair a bot whose folder was broken by hand', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    await writeFile(join(dir, 'bots', name, 'SKILL.md'), 'quebrado');
    await syncBots(services(), dir);
    expect((await getBot(services(), dir, bot.id)).loadError).toBeDefined();
    const fixed = await updateBotSkill(services(), dir, bot.id, skillText(name, 'consertado'));
    expect(fixed.loadError).toBeUndefined();
    expect(fixed.skill?.body).toContain('consertado');
  });

  it('is NotFound for an unknown or removed bot', async () => {
    const dir = await freshDir();
    await expect(updateBotSkill(services(), dir, newId('bot'), 'x')).rejects.toBeInstanceOf(
      NotFound,
    );
    const { bot } = await newBot(dir);
    await removeBot(services(), dir, bot.id);
    await expect(updateBotSkill(services(), dir, bot.id, 'x')).rejects.toBeInstanceOf(NotFound);
  });
});

describe('updateBotConfig', () => {
  it('changes only the named fields and keeps comments and key order', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    const file = join(dir, 'bots', name, 'bot.yaml');
    await writeFile(file, `# o time de dev\n${await readFile(file, 'utf8')}`);
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'comment');
    const updated = await updateBotConfig(services(), dir, bot.id, {
      displayName: 'Renomeado',
      enabled: false,
      limits: { maxTurns: 5, maxRunMinutes: 10, maxParallelRuns: 2 },
    });
    expect(updated).toMatchObject({ displayName: 'Renomeado', enabled: false, kind: 'dev' });
    expect(updated.config?.limits).toEqual({ maxTurns: 5, maxRunMinutes: 10, maxParallelRuns: 2 });
    const text = await readFile(file, 'utf8');
    expect(text.startsWith('# o time de dev')).toBe(true);
    expect(text.indexOf('slug:')).toBeLessThan(text.indexOf('displayName:'));
    expect(messages(dir)[0]).toBe(`bot(${name}): update config`);
  });

  it('refuses an invalid result and leaves the file and history alone', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    const file = join(dir, 'bots', name, 'bot.yaml');
    const before = await readFile(file, 'utf8');
    for (const patch of [
      { engines: [] },
      { engines: ['claude', 'claude'] },
      { kind: 'nope' },
      { limits: { maxTurns: 0 } },
      { displayName: '' },
    ])
      await expect(updateBotConfig(services(), dir, bot.id, patch as never)).rejects.toBeInstanceOf(
        ValidationFailed,
      );
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(messages(dir)).toHaveLength(1);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('cannot rename the folder through the slug', async () => {
    const dir = await freshDir();
    const { bot } = await newBot(dir);
    await expect(
      updateBotConfig(services(), dir, bot.id, { slug: 'outro' } as never),
    ).rejects.toBeInstanceOf(ValidationFailed);
  });
});

describe('removeBot', () => {
  it('deletes the folder, commits the removal and marks the bot removed', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    await removeBot(services(), dir, bot.id);
    expect(existsSync(join(dir, 'bots', name))).toBe(false);
    expect(messages(dir)[0]).toBe(`bot(${name}): remove`);
    expect((await listBots(services())).some((item) => item.slug === name)).toBe(false);
  });

  it('is refused while the bot has running runs, and nothing changes', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    const busy = services({ botHasRunningRuns: async () => true });
    await expect(removeBot(busy, dir, bot.id)).rejects.toBeInstanceOf(Conflict);
    expect(existsSync(join(dir, 'bots', name))).toBe(true);
    expect(messages(dir)).toHaveLength(1);
  });
});

describe('history and revert', () => {
  it('lists the commits of one bot, newest first, and not those of another', async () => {
    const dir = await freshDir();
    const a = await newBot(dir);
    const b = await newBot(dir);
    await updateBotSkill(services(), dir, a.bot.id, skillText(a.name, 'um'));
    await updateBotSkill(services(), dir, b.bot.id, skillText(b.name, 'outro'));
    const history = await botHistory(services(), dir, a.bot.id);
    expect(history.map((entry) => entry.message)).toEqual([
      `bot(${a.name}): update behavior`,
      `bot(${a.name}): create`,
    ]);
    expect(history[0]).toMatchObject({
      author: 'Motes',
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    expect(await botHistory(services(), dir, a.bot.id, 1)).toHaveLength(1);
  });

  it('a revert restores the previous behavior and records itself', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    const original = await readFile(join(dir, 'bots', name, 'SKILL.md'), 'utf8');
    await updateBotSkill(services(), dir, bot.id, skillText(name, 'comportamento ruim'));
    const [edit] = await botHistory(services(), dir, bot.id);
    const reverted = await revertBot(services(), dir, bot.id, edit?.commit ?? '');
    expect(await readFile(join(dir, 'bots', name, 'SKILL.md'), 'utf8')).toBe(original);
    expect(reverted.skill?.body).not.toContain('ruim');
    expect(messages(dir)[0]).toBe(`bot(${name}): revert ${edit?.commit.slice(0, 7)}`);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('accepts a short hash', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    await updateBotSkill(services(), dir, bot.id, skillText(name, 'x'));
    const [edit] = await botHistory(services(), dir, bot.id);
    await revertBot(services(), dir, bot.id, (edit?.commit ?? '').slice(0, 8));
    expect((await botHistory(services(), dir, bot.id))[0]?.message).toContain('revert');
  });

  it("refuses the creation commit, another bot's commit, a stranger and an unknown hash", async () => {
    const dir = await freshDir();
    const a = await newBot(dir);
    const b = await newBot(dir);
    const [created] = await botHistory(services(), dir, a.bot.id);
    await expect(
      revertBot(services(), dir, a.bot.id, created?.commit ?? ''),
    ).rejects.toBeInstanceOf(ValidationFailed);
    const [other] = await botHistory(services(), dir, b.bot.id);
    await expect(revertBot(services(), dir, a.bot.id, other?.commit ?? '')).rejects.toBeInstanceOf(
      ValidationFailed,
    );
    await expect(revertBot(services(), dir, a.bot.id, 'deadbeef')).rejects.toBeInstanceOf(NotFound);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('refuses a revert that no longer applies and leaves the folder as it was', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    await updateBotSkill(services(), dir, bot.id, skillText(name, 'primeira'));
    const [first] = await botHistory(services(), dir, bot.id);
    await updateBotSkill(services(), dir, bot.id, skillText(name, 'segunda'));
    const before = await readFile(join(dir, 'bots', name, 'SKILL.md'), 'utf8');
    await expect(revertBot(services(), dir, bot.id, first?.commit ?? '')).rejects.toBeInstanceOf(
      Conflict,
    );
    expect(await readFile(join(dir, 'bots', name, 'SKILL.md'), 'utf8')).toBe(before);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });
});

describe('concurrent writes', () => {
  it('apply one after the other, each with its own commit', async () => {
    const dir = await freshDir();
    const { bot, name } = await newBot(dir);
    await Promise.all([
      updateBotSkill(services(), dir, bot.id, skillText(name, 'a')),
      updateBotConfig(services(), dir, bot.id, { displayName: 'Dois' }),
      updateBotSkill(services(), dir, bot.id, skillText(name, 'b')),
    ]);
    expect(messages(dir)).toHaveLength(4);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });
});
