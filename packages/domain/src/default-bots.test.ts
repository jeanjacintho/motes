import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { removeBot, updateBotSkill } from './bot-editing.js';
import { DEFAULT_BOTS, seedDefaultBots } from './default-bots.js';
import { ensureSkillsDirectory, getBot, listBots, syncBots } from './skills.js';

const testDb = withTestDb();
const services = () => ({
  db: testDb.db,
  appendEvent,
  clock: () => new Date('2026-10-31T10:00:00.000Z'),
  newId,
});

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'motes-seed-'));
});
afterAll(() => rm(root, { recursive: true, force: true }));
// The index keeps a row for every bot it has seen, so each test starts from a fresh install.
beforeEach(async () => {
  await testDb.db.$client`DELETE FROM bots`;
});

let counter = 0;
const freshDir = async () => {
  const dir = join(root, String(counter++));
  await ensureSkillsDirectory(dir);
  return dir;
};
const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

describe('seedDefaultBots', () => {
  it('gives a fresh install the Dev bot, valid, indexed and committed', async () => {
    const dir = await freshDir();
    expect(await seedDefaultBots(services(), dir)).toEqual(['dev']);
    const [dev] = await listBots(services());
    expect(dev).toMatchObject({
      slug: 'dev',
      displayName: 'Dev',
      kind: 'dev',
      engines: ['claude', 'codex'],
      enabled: true,
    });
    expect(dev?.loadError).toBeUndefined();
    const detail = await getBot(services(), dir, dev?.id ?? '');
    expect(detail.skill?.frontMatter.name).toBe('dev');
    expect(detail.skill?.body).toContain('.motes/context.md');
    expect(git(dir, 'log', '--format=%s')).toBe('bot(dev): create default bot');
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('tells the Dev bot to stay in the worktree, run the tests and end with a summary', () => {
    const skill = DEFAULT_BOTS.find((bot) => bot.slug === 'dev')?.skill ?? '';
    for (const phrase of ['.motes/context.md', 'worktree', 'tests', 'summary'])
      expect(skill, phrase).toContain(phrase);
  });

  it('is idempotent: seeding again changes nothing', async () => {
    const dir = await freshDir();
    await seedDefaultBots(services(), dir);
    const before = git(dir, 'rev-parse', 'HEAD');
    expect(await seedDefaultBots(services(), dir)).toEqual([]);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(before);
    expect(await listBots(services())).toHaveLength(1);
  });

  it('never overwrites an existing folder, even one the index has not seen', async () => {
    const dir = await freshDir();
    const folder = join(dir, 'bots', 'dev');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'SKILL.md'), 'meu texto, ainda sem front matter');
    expect(await seedDefaultBots(services(), dir)).toEqual([]);
    expect(await readFile(join(folder, 'SKILL.md'), 'utf8')).toBe(
      'meu texto, ainda sem front matter',
    );
    expect(existsSync(join(folder, 'bot.yaml'))).toBe(false);
  });

  it('keeps an edited skill across restarts', async () => {
    const dir = await freshDir();
    await seedDefaultBots(services(), dir);
    const [dev] = await listBots(services());
    const edited = `---\nname: dev\ndescription: Meu Dev.\n---\nTrabalhe do meu jeito.\n`;
    await updateBotSkill(services(), dir, dev?.id ?? '', edited);
    // A restart seeds again, with the same database or with the index rebuilt from the folders.
    expect(await seedDefaultBots(services(), dir)).toEqual([]);
    await testDb.db.$client`DELETE FROM bots`;
    expect(await seedDefaultBots(services(), dir)).toEqual([]);
    await syncBots(services(), dir);
    const [again] = await listBots(services());
    expect((await getBot(services(), dir, again?.id ?? '')).skill?.body).toContain('do meu jeito');
    expect(await readFile(join(dir, 'bots', 'dev', 'SKILL.md'), 'utf8')).toBe(edited);
  });

  it('does not bring the bot back after the owner deleted it', async () => {
    const dir = await freshDir();
    await seedDefaultBots(services(), dir);
    const [dev] = await listBots(services());
    await removeBot(services(), dir, dev?.id ?? '');
    expect(await seedDefaultBots(services(), dir)).toEqual([]);
    expect(existsSync(join(dir, 'bots', 'dev'))).toBe(false);
    expect(await listBots(services())).toEqual([]);
  });

  it('seeds into a repository that already has history, without touching it', async () => {
    const dir = await freshDir();
    await writeFile(join(dir, 'README.md'), 'meu repositório');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'antes');
    await seedDefaultBots(services(), dir);
    expect(git(dir, 'log', '--format=%s')).toBe('bot(dev): create default bot\nantes');
    expect(await readFile(join(dir, 'README.md'), 'utf8')).toBe('meu repositório');
  });
});
