import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent, botExists } from '@motes/db';
import { withTestDb } from '@motes/db/testing';
import { newId } from '@motes/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFound } from './errors.js';
import { ensureSkillsDirectory, getBot, listBots, syncBots, watchSkills } from './skills.js';

const testDb = withTestDb();

function services() {
  return {
    db: testDb.db,
    appendEvent,
    clock: () => new Date('2026-10-31T10:00:00.000Z'),
    newId,
  };
}

const skill = (slug: string, extra = '') => `---
name: ${slug}
description: Does the ${slug} work.
---
# ${slug}

${extra}`;
const config = (slug: string, extra = '') => `slug: ${slug}
displayName: ${slug.toUpperCase()}
kind: dev
engines: [claude]
${extra}`;

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'motes-skills-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

// Each test gets its own skills directory so folders never leak between them.
let counter = 0;
async function freshDir() {
  const root = join(dir, String(counter++));
  await ensureSkillsDirectory(root);
  return root;
}

async function writeBot(root: string, slug: string, files: Record<string, string> = {}) {
  const folder = join(root, 'bots', slug);
  await mkdir(folder, { recursive: true });
  const all = { 'SKILL.md': skill(slug), 'bot.yaml': config(slug), ...files };
  for (const [name, content] of Object.entries(all)) {
    await mkdir(join(folder, name, '..'), { recursive: true });
    await writeFile(join(folder, name), content);
  }
  return folder;
}

// Slugs are unique across the database, so every test makes its own.
let slugs = 0;
const slug = (label: string) => `${label}-${Date.now().toString(36)}-${slugs++}`;

async function botEvents(botId: string) {
  const rows = await testDb.db.$client`
    SELECT type, actor, payload FROM events WHERE subject_id = ${botId} ORDER BY seq`;
  return rows.map((row) => [row.type, row.payload.slug, row.actor.kind]);
}

const find = async (name: string) => (await listBots(services())).find((bot) => bot.slug === name);

describe('ensureSkillsDirectory', () => {
  it('creates bots/ and shared/ and turns the directory into a git repository', async () => {
    const root = join(dir, 'ensure');
    await ensureSkillsDirectory(root);
    expect(existsSync(join(root, 'bots'))).toBe(true);
    expect(existsSync(join(root, 'shared'))).toBe(true);
    expect(existsSync(join(root, '.git'))).toBe(true);
    expect(
      execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']).toString(),
    ).toMatch(/true/);
  });

  it('leaves an existing repository and its files alone', async () => {
    const root = join(dir, 'ensure-twice');
    await ensureSkillsDirectory(root);
    await writeFile(join(root, 'notes.txt'), 'keep');
    execFileSync('git', ['-C', root, 'config', 'user.email', 'a@b.c']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'A']);
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, 'commit', '-qm', 'first']);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD']).toString();
    await ensureSkillsDirectory(root);
    expect(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD']).toString()).toBe(head);
  });

  it('does not start a nested repository inside an existing one', async () => {
    const outer = join(dir, 'outer');
    await mkdir(outer, { recursive: true });
    execFileSync('git', ['-C', outer, 'init', '-q']);
    const inner = join(outer, 'skills');
    await ensureSkillsDirectory(inner);
    expect(existsSync(join(inner, '.git'))).toBe(false);
    expect(existsSync(join(inner, 'bots'))).toBe(true);
  });
});

describe('syncBots', () => {
  it('indexes a new folder and emits bot.created once', async () => {
    const root = await freshDir();
    const name = slug('dev');
    await writeBot(root, name, { 'bot.yaml': config(name, 'models:\n  cheap_llm: haiku\n') });
    await syncBots(services(), root);
    const bot = await find(name);
    expect(bot).toMatchObject({
      slug: name,
      displayName: name.toUpperCase(),
      kind: 'dev',
      engines: ['claude'],
      enabled: true,
    });
    expect(bot?.skillDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(bot?.loadError).toBeUndefined();
    expect(await botEvents(bot?.id as string)).toEqual([['bot.created', name, 'system']]);
    await syncBots(services(), root);
    expect(await botEvents(bot?.id as string)).toHaveLength(1);
  });

  it('updates the index and emits bot.updated when the folder changes', async () => {
    const root = await freshDir();
    const name = slug('edit');
    const folder = await writeBot(root, name);
    await syncBots(services(), root);
    const created = await find(name);
    await writeFile(join(folder, 'SKILL.md'), skill(name, 'Be careful.\n'));
    await syncBots(services(), root);
    const edited = await find(name);
    expect(edited?.skillDigest).not.toBe(created?.skillDigest);
    await writeFile(join(folder, 'bot.yaml'), config(name, 'enabled: false\n'));
    await syncBots(services(), root);
    expect(await find(name)).toMatchObject({ id: created?.id, enabled: false });
    await mkdir(join(folder, 'references'), { recursive: true });
    await writeFile(join(folder, 'references', 'faq.md'), 'x');
    await syncBots(services(), root);
    expect((await botEvents(created?.id as string)).map(([type]) => type)).toEqual([
      'bot.created',
      'bot.updated',
      'bot.updated',
      'bot.updated',
    ]);
  });

  it('marks a deleted folder removed, then revives the same bot when it returns', async () => {
    const root = await freshDir();
    const name = slug('gone');
    const folder = await writeBot(root, name);
    await syncBots(services(), root);
    const original = await find(name);
    await rm(folder, { recursive: true });
    await syncBots(services(), root);
    expect(await find(name)).toBeUndefined();
    expect(await botExists(testDb.db, original?.id as string)).toBe(false);
    await syncBots(services(), root);
    await writeBot(root, name);
    await syncBots(services(), root);
    expect(await find(name)).toMatchObject({ id: original?.id });
    expect(await botExists(testDb.db, original?.id as string)).toBe(true);
    expect((await botEvents(original?.id as string)).map(([type]) => type)).toEqual([
      'bot.created',
      'bot.removed',
      'bot.created',
    ]);
  });

  it('keeps the last valid version when an edit breaks the folder, and recovers on the fix', async () => {
    const root = await freshDir();
    const name = slug('broken');
    const folder = await writeBot(root, name, { 'bot.yaml': config(name, 'effort: high\n') });
    await syncBots(services(), root);
    const good = await find(name);
    await writeFile(join(folder, 'bot.yaml'), config(name, 'engines: [gemini]\n'));
    await syncBots(services(), root);
    const broken = await find(name);
    expect(broken).toMatchObject({
      id: good?.id,
      engines: ['claude'],
      skillDigest: good?.skillDigest,
    });
    expect(broken?.loadError).toMatch(/bot\.yaml/);
    await syncBots(services(), root);
    await writeFile(join(folder, 'bot.yaml'), config(name, 'enabled: false\n'));
    await syncBots(services(), root);
    const fixed = await find(name);
    expect(fixed?.loadError).toBeUndefined();
    expect(fixed?.enabled).toBe(false);
    // The same broken state twice is one event; the break and the fix are one each.
    expect((await botEvents(good?.id as string)).map(([type]) => type)).toEqual([
      'bot.created',
      'bot.updated',
      'bot.updated',
    ]);
  });

  it('does not index a folder that was never valid, and picks it up once fixed', async () => {
    const root = await freshDir();
    const name = slug('never');
    const folder = await writeBot(root, name, { 'bot.yaml': 'kind: nope' });
    await syncBots(services(), root);
    expect(await find(name)).toBeUndefined();
    await writeFile(join(folder, 'bot.yaml'), config(name));
    await syncBots(services(), root);
    expect(await find(name)).toBeDefined();
  });

  it('ignores files, hidden folders, invalid names and symlinked folders', async () => {
    const root = await freshDir();
    const name = slug('real');
    await writeBot(root, name);
    await writeFile(join(root, 'bots', 'README.md'), 'hello');
    await mkdir(join(root, 'bots', '.hidden'), { recursive: true });
    await writeBot(root, 'Not_A_Slug');
    const outside = await mkdtemp(join(tmpdir(), 'motes-outside-'));
    const target = join(outside, 'linked');
    await mkdir(target);
    await writeFile(join(target, 'SKILL.md'), skill('linked'));
    await writeFile(join(target, 'bot.yaml'), config('linked'));
    await symlink(target, join(root, 'bots', 'linked'));
    await syncBots(services(), root);
    expect((await listBots(services())).map((bot) => bot.slug)).toEqual([name]);
    await rm(outside, { recursive: true, force: true });
  });
});

describe('listBots and getBot', () => {
  it('lists live bots by slug and reads config and skill from disk', async () => {
    const root = await freshDir();
    const a = slug('aa');
    const folder = await writeBot(root, a, { 'references/faq.md': '# FAQ' });
    await syncBots(services(), root);
    const bot = await find(a);
    const detail = await getBot(services(), root, bot?.id as string);
    expect(detail).toMatchObject({
      slug: a,
      config: { kind: 'dev', engines: ['claude'], enabled: true },
      skill: { frontMatter: { name: a }, body: expect.stringContaining(`# ${a}`) },
      references: ['references/faq.md'],
    });
    // The behavior is read from the file each time, never copied into the database.
    await writeFile(join(folder, 'SKILL.md'), skill(a, 'Edited just now.\n'));
    expect((await getBot(services(), root, bot?.id as string)).skill?.body).toContain(
      'Edited just now',
    );
  });

  it('returns the index with null content while the folder is broken, and NotFound otherwise', async () => {
    const root = await freshDir();
    const name = slug('bad');
    const folder = await writeBot(root, name);
    await syncBots(services(), root);
    const bot = await find(name);
    await writeFile(join(folder, 'SKILL.md'), 'no front matter');
    await syncBots(services(), root);
    const detail = await getBot(services(), root, bot?.id as string);
    expect(detail).toMatchObject({ config: null, skill: null, references: [] });
    expect(detail.loadError).toMatch(/SKILL\.md/);
    await expect(getBot(services(), root, newId('bot'))).rejects.toBeInstanceOf(NotFound);
    await rm(folder, { recursive: true });
    await syncBots(services(), root);
    await expect(getBot(services(), root, bot?.id as string)).rejects.toBeInstanceOf(NotFound);
  });
});

describe('watchSkills', () => {
  it('indexes the folders present at start and follows adds, edits and deletes', async () => {
    const root = await freshDir();
    const first = slug('first');
    await writeBot(root, first);
    const watcher = watchSkills(services(), root, { debounceMs: 20 });
    try {
      await watcher.ready;
      expect(await find(first)).toBeDefined();
      const second = slug('second');
      const folder = await writeBot(root, second);
      await expect.poll(() => find(second), { timeout: 5000 }).toBeDefined();
      const digest = (await find(second))?.skillDigest;
      await writeFile(join(folder, 'SKILL.md'), skill(second, 'Changed.\n'));
      await expect
        .poll(async () => (await find(second))?.skillDigest, { timeout: 5000 })
        .not.toBe(digest);
      await rm(folder, { recursive: true });
      await expect.poll(() => find(second), { timeout: 5000 }).toBeUndefined();
    } finally {
      await watcher.stop();
    }
  });

  it('stops following changes after stop()', async () => {
    const root = await freshDir();
    const watcher = watchSkills(services(), root, { debounceMs: 20 });
    await watcher.ready;
    await watcher.stop();
    const late = slug('late');
    await writeBot(root, late);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await find(late)).toBeUndefined();
  });

  it('reports a failed sync instead of crashing the process', async () => {
    const root = join(dir, 'missing-root');
    const errors: unknown[] = [];
    const watcher = watchSkills(services(), root, { onError: (error) => errors.push(error) });
    await watcher.ready;
    await watcher.stop();
    expect(errors).toHaveLength(1);
  });
});
