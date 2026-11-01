import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BotFolderInvalid,
  loadBotFolder,
  loadSkillFolder,
  parseSkillMarkdown,
} from './bot-folder.js';

const SKILL = `---
name: support
description: Answers customers politely.
---
# Support

Reply in the customer's language.
`;
const BOT = `slug: support
displayName: Support
kind: office
engines: [claude, codex]
models:
  cheap_llm: haiku
`;

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'motes-bots-'));
});
afterAll(() => rm(root, { recursive: true, force: true }));

let counter = 0;
/** Builds `<root>/<n>/<slug>` and returns its path; files are written as given. */
async function folder(files: Record<string, string>, slug = 'support') {
  const dir = join(root, String(counter++), slug);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(BotFolderInvalid);
  return error as BotFolderInvalid;
}

describe('parseSkillMarkdown', () => {
  it('splits the front matter from the body and keeps the body as written', () => {
    const { frontMatter, body } = parseSkillMarkdown(SKILL);
    expect(frontMatter).toEqual({ name: 'support', description: 'Answers customers politely.' });
    expect(body).toBe("# Support\n\nReply in the customer's language.\n");
  });

  it('accepts CRLF line endings and a byte order mark', () => {
    const windows = `﻿${SKILL.replaceAll('\n', '\r\n')}`;
    expect(parseSkillMarkdown(windows).frontMatter.name).toBe('support');
  });

  it('does not mistake a horizontal rule in the body for the end of the front matter', () => {
    const text = `${SKILL}\n---\n\nMore.\n`;
    expect(parseSkillMarkdown(text).body).toContain('---\n\nMore.');
  });

  it('explains what is wrong, naming the file', () => {
    const issues = (text: string) => {
      try {
        parseSkillMarkdown(text);
      } catch (error) {
        return (error as BotFolderInvalid).issues;
      }
      return [];
    };
    expect(issues('# no front matter')[0]).toMatchObject({ file: 'SKILL.md' });
    expect(issues('---\nname: x\n')[0]?.message).toMatch(/closing/);
    expect(issues('---\nname: [oops\n---\n')[0]?.message).toMatch(/YAML/);
    expect(issues('---\n- a\n- b\n---\n')[0]?.message).toMatch(/mapping/);
    expect(issues('---\nname: support\n---\n')[0]).toMatchObject({
      file: 'SKILL.md',
      path: 'description',
    });
  });
});

describe('loadBotFolder', () => {
  it('loads the config with defaults, the skill and the reference files', async () => {
    const dir = await folder({
      'SKILL.md': SKILL,
      'bot.yaml': BOT,
      'references/faq.md': '# FAQ',
      'references/examples/refund.md': 'x',
    });
    await symlink('/etc/hosts', join(dir, 'references', 'leak.txt'));
    const bot = await loadBotFolder(dir);
    expect(bot.config).toMatchObject({
      slug: 'support',
      displayName: 'Support',
      kind: 'office',
      engines: ['claude', 'codex'],
      models: { cheap_llm: 'haiku' },
      limits: { maxTurns: 30, maxRunMinutes: 30, maxParallelRuns: 1 },
      skills: [],
      enabled: true,
    });
    expect(bot.skill.frontMatter.name).toBe('support');
    expect(bot.skill.body).toContain("customer's language");
    expect(bot.references).toEqual(['references/examples/refund.md', 'references/faq.md']);
  });

  it('does not follow a references directory that is itself a link', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'motes-outside-'));
    await writeFile(join(outside, 'private.txt'), 'secret');
    const bot = await folder({ 'SKILL.md': SKILL, 'bot.yaml': BOT });
    await symlink(outside, join(bot, 'references'));
    expect((await loadBotFolder(bot)).references).toEqual([]);
    const shared = await folder(
      { 'SKILL.md': SKILL.replace('name: support', 'name: shared-one') },
      'shared-one',
    );
    await symlink(outside, join(shared, 'references'));
    expect((await loadSkillFolder(shared)).references).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });

  it('works without a references directory', async () => {
    const dir = await folder({ 'SKILL.md': SKILL, 'bot.yaml': BOT });
    expect((await loadBotFolder(dir)).references).toEqual([]);
  });

  it('fails with a readable error when SKILL.md or bot.yaml is missing', async () => {
    const noSkill = await failure(loadBotFolder(await folder({ 'bot.yaml': BOT })));
    expect(noSkill.issues).toEqual([
      { file: 'SKILL.md', path: '', message: expect.stringMatching(/missing/i) },
    ]);
    const noConfig = await failure(loadBotFolder(await folder({ 'SKILL.md': SKILL })));
    expect(noConfig.issues[0]).toMatchObject({ file: 'bot.yaml' });
    expect(noConfig.message).toContain('bot.yaml');
    await failure(loadBotFolder(join(root, 'does-not-exist')));
  });

  it('rejects a non-standard field in the skill front matter, naming the field', async () => {
    const skill = SKILL.replace('---\n#', 'engine: claude\n---\n#');
    const error = await failure(
      loadBotFolder(await folder({ 'SKILL.md': skill, 'bot.yaml': BOT })),
    );
    expect(error.issues[0]).toMatchObject({ file: 'SKILL.md' });
    expect(error.message).toMatch(/SKILL\.md.*engine/s);
  });

  it('rejects an unknown engine, pointing at the list entry', async () => {
    const error = await failure(
      loadBotFolder(
        await folder({
          'SKILL.md': SKILL,
          'bot.yaml': BOT.replace('[claude, codex]', '[claude, gemini]'),
        }),
      ),
    );
    expect(error.issues).toEqual([
      { file: 'bot.yaml', path: 'engines.1', message: expect.stringContaining('') },
    ]);
    expect(error.message).toContain('bot.yaml: engines.1');
  });

  it('reports every problem at once, across both files', async () => {
    const error = await failure(
      loadBotFolder(
        await folder({
          'SKILL.md': '---\nname: support\n---\n',
          'bot.yaml': 'slug: support\nkind: boss\nengines: []\n',
        }),
      ),
    );
    const files = new Set(error.issues.map((issue) => issue.file));
    expect(files).toEqual(new Set(['SKILL.md', 'bot.yaml']));
    expect(error.issues.length).toBeGreaterThanOrEqual(4);
  });

  it('requires the slug and the skill name to match the folder name', async () => {
    const renamed = await folder({ 'SKILL.md': SKILL, 'bot.yaml': BOT }, 'other-bot');
    const error = await failure(loadBotFolder(renamed));
    expect(error.issues.map((issue) => [issue.file, issue.path])).toEqual([
      ['SKILL.md', 'name'],
      ['bot.yaml', 'slug'],
    ]);
    expect(error.message).toContain('other-bot');
  });

  it('rejects malformed YAML in bot.yaml and oversized files', async () => {
    const broken = await failure(
      loadBotFolder(await folder({ 'SKILL.md': SKILL, 'bot.yaml': 'slug: [support' })),
    );
    expect(broken.issues[0]).toMatchObject({ file: 'bot.yaml' });
    expect(broken.issues[0]?.message).toMatch(/YAML/);
    const huge = await failure(
      loadBotFolder(
        await folder({ 'SKILL.md': `${SKILL}${'x'.repeat(300_000)}`, 'bot.yaml': BOT }),
      ),
    );
    expect(huge.issues[0]).toMatchObject({ file: 'SKILL.md' });
    expect(huge.issues[0]?.message).toMatch(/large/);
  });

  it('refuses a SKILL.md or bot.yaml that is a symlink', async () => {
    const dir = await folder({ 'bot.yaml': BOT });
    await symlink('/etc/hosts', join(dir, 'SKILL.md'));
    expect((await failure(loadBotFolder(dir))).issues[0]).toMatchObject({ file: 'SKILL.md' });
  });
});

describe('digest', () => {
  const digestOf = async (files: Record<string, string>) =>
    (await loadBotFolder(await folder(files))).digest;
  const base = { 'SKILL.md': SKILL, 'bot.yaml': BOT, 'references/faq.md': 'one' };

  it('is stable for identical content and changes with any file', async () => {
    const original = await digestOf(base);
    expect(original).toMatch(/^[0-9a-f]{64}$/);
    expect(await digestOf(base)).toBe(original);
    expect(await digestOf({ ...base, 'SKILL.md': `${SKILL}\nMore.\n` })).not.toBe(original);
    expect(await digestOf({ ...base, 'bot.yaml': `${BOT}enabled: false\n` })).not.toBe(original);
    expect(await digestOf({ ...base, 'references/faq.md': 'two' })).not.toBe(original);
    expect(await digestOf({ ...base, 'references/other.md': 'one' })).not.toBe(original);
  });
});

describe('digest of large references', () => {
  it('changes when a reference above the read limit changes without changing its length', async () => {
    const big = (letter: string) => `${letter}${'x'.repeat(300_000)}`;
    const files = { 'SKILL.md': SKILL, 'bot.yaml': BOT };
    const one = await loadBotFolder(await folder({ ...files, 'references/manual.md': big('a') }));
    const two = await loadBotFolder(await folder({ ...files, 'references/manual.md': big('b') }));
    expect(two.digest).not.toBe(one.digest);
  });
});

describe('loadSkillFolder', () => {
  it('loads a shared skill, which has no bot.yaml', async () => {
    const dir = await folder(
      { 'SKILL.md': SKILL.replace('name: support', 'name: release-playbook') },
      'release-playbook',
    );
    const skill = await loadSkillFolder(dir);
    expect(skill.skill.frontMatter.name).toBe('release-playbook');
    await failure(loadSkillFolder(await folder({ 'SKILL.md': SKILL }, 'wrong-name')));
  });
});
