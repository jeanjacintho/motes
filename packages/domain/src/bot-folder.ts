import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type BotConfig,
  botConfigSchema,
  type SkillFrontMatter,
  skillFrontMatterSchema,
} from '@motes/protocol';
import { parse as parseYaml } from 'yaml';

export type FolderIssue = { file: string; path: string; message: string };

/** A skill or bot folder that cannot be loaded; every issue names the file it is about. */
export class BotFolderInvalid extends Error {
  constructor(readonly issues: FolderIssue[]) {
    super(
      issues
        .map((issue) => `${issue.file}${issue.path ? `: ${issue.path}` : ''}: ${issue.message}`)
        .join('\n'),
    );
  }
}

export type Skill = { frontMatter: SkillFrontMatter; body: string };
/** `digest` changes whenever SKILL.md, bot.yaml or any reference file changes. */
export type SkillFolder = { skill: Skill; references: string[]; digest: string };
export type BotFolder = SkillFolder & { config: BotConfig };

/** A behavior file this large is a mistake, and the loader reads whole files into memory. */
const MAX_FILE_BYTES = 256 * 1024;

const fail = (file: string, message: string, path = ''): never => {
  throw new BotFolderInvalid([{ file, path, message }]);
};

function zodIssues(
  file: string,
  error: { issues: { path: PropertyKey[]; message: string }[] },
): FolderIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function parseYamlDocument(file: string, text: string): unknown {
  try {
    return parseYaml(text);
  } catch (error) {
    return fail(file, `Invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Splits SKILL.md into its front matter and its markdown body. */
export function parseSkillMarkdown(raw: string, file = 'SKILL.md'): Skill {
  const text = raw.replace(/^﻿/, '').replaceAll('\r\n', '\n');
  if (!text.startsWith('---\n'))
    return fail(file, 'The file must start with a --- front matter block');
  const end = text.indexOf('\n---\n', 3);
  const closing = end >= 0 ? end : text.endsWith('\n---') ? text.length - 4 : -1;
  if (closing < 0) return fail(file, 'The front matter has no closing --- line');
  const data = parseYamlDocument(file, text.slice(4, closing + 1));
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return fail(file, 'The front matter must be a YAML mapping of keys to values');
  const parsed = skillFrontMatterSchema.safeParse(data);
  if (!parsed.success) throw new BotFolderInvalid(zodIssues(file, parsed.error));
  return { frontMatter: parsed.data, body: text.slice(closing + 5) };
}

/** The file's text, or undefined when it does not exist. Symlinks are refused, not followed. */
async function readTextFile(dir: string, name: string): Promise<string | undefined> {
  const path = join(dir, name);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (!info.isFile()) return fail(name, 'Must be a regular file, not a link or a directory');
  if (info.size > MAX_FILE_BYTES)
    return fail(name, `The file is too large (the limit is ${MAX_FILE_BYTES / 1024} KiB)`);
  return readFile(path, 'utf8');
}

async function listReferences(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(join(dir, relative), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) found.push(child);
    }
  };
  // readdir follows links, so the root must be checked here; entries below it come typed.
  try {
    if (!(await lstat(join(dir, 'references'))).isDirectory()) return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  await walk('references');
  return found.sort();
}

async function loadSkill(
  dir: string,
  issues: FolderIssue[],
): Promise<{ skill: Skill; raw: string } | undefined> {
  try {
    const text = await readTextFile(dir, 'SKILL.md');
    if (text === undefined) {
      issues.push({ file: 'SKILL.md', path: '', message: 'The file is missing' });
      return undefined;
    }
    const skill = parseSkillMarkdown(text);
    if (skill.frontMatter.name !== basename(dir))
      issues.push({
        file: 'SKILL.md',
        path: 'name',
        message: `Must equal the folder name "${basename(dir)}", found "${skill.frontMatter.name}"`,
      });
    return { skill, raw: text };
  } catch (error) {
    if (error instanceof BotFolderInvalid) issues.push(...error.issues);
    else throw error;
    return undefined;
  }
}

/** Hashes the behavior files and every byte of the reference files, which are streamed. */
async function digestOf(dir: string, texts: string[], references: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const text of texts) hash.update(`${text.length}:${text}`);
  for (const reference of references) {
    hash.update(`${reference}\0`);
    for await (const chunk of createReadStream(join(dir, reference))) hash.update(chunk);
  }
  return hash.digest('hex');
}

/** A shared skill: SKILL.md plus optional references. The name must equal the folder name. */
export async function loadSkillFolder(path: string): Promise<SkillFolder> {
  const issues: FolderIssue[] = [];
  const loaded = await loadSkill(path, issues);
  if (issues.length > 0 || !loaded) throw new BotFolderInvalid(issues);
  const references = await listReferences(path);
  return {
    skill: loaded.skill,
    references,
    digest: await digestOf(path, [loaded.raw], references),
  };
}

/**
 * A bot: a skill folder plus bot.yaml. All problems of both files are reported together, so one
 * edit can fix them all. The slug and the skill name must equal the folder name.
 */
export async function loadBotFolder(path: string): Promise<BotFolder> {
  const issues: FolderIssue[] = [];
  const loaded = await loadSkill(path, issues);
  let config: BotConfig | undefined;
  let configText = '';
  try {
    const text = await readTextFile(path, 'bot.yaml');
    if (text === undefined)
      issues.push({ file: 'bot.yaml', path: '', message: 'The file is missing' });
    else {
      configText = text;
      const parsed = botConfigSchema.safeParse(parseYamlDocument('bot.yaml', text));
      if (!parsed.success) issues.push(...zodIssues('bot.yaml', parsed.error));
      else if (parsed.data.slug !== basename(path))
        issues.push({
          file: 'bot.yaml',
          path: 'slug',
          message: `Must equal the folder name "${basename(path)}", found "${parsed.data.slug}"`,
        });
      else config = parsed.data;
    }
  } catch (error) {
    if (error instanceof BotFolderInvalid) issues.push(...error.issues);
    else throw error;
  }
  if (issues.length > 0 || !loaded || !config) throw new BotFolderInvalid(issues);
  const references = await listReferences(path);
  return {
    config,
    skill: loaded.skill,
    references,
    digest: await digestOf(path, [loaded.raw, configText], references),
  };
}
