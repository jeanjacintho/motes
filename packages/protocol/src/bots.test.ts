import { describe, expect, test, vi } from 'vitest';
import {
  botConfigPatchSchema,
  botConfigSchema,
  botDetailSchema,
  botSummarySchema,
  newId,
  parseClientEvent,
  parseEvent,
  skillFrontMatterSchema,
  slugSchema,
} from './index.js';

describe('slugs', () => {
  test.each(['dev', 'support-2', 'a'])('accepts %s', (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });
  test.each(['', 'Dev', '-dev', 'dev-', 'de--v', 'de v', 'dév', 'a'.repeat(65), '../dev'])(
    'rejects %j',
    (slug) => {
      expect(slugSchema.safeParse(slug).success).toBe(false);
    },
  );
});

describe('skill front matter', () => {
  const valid = { name: 'support', description: 'Answers customers politely.' };

  test('accepts the standard fields', () => {
    const full = {
      ...valid,
      license: 'MIT',
      compatibility: 'Needs git',
      metadata: { author: 'jean' },
      'allowed-tools': 'Bash(git:*) Read',
    };
    expect(skillFrontMatterSchema.parse(full)).toEqual(full);
    expect(skillFrontMatterSchema.parse(valid)).toEqual(valid);
  });

  test('rejects fields outside the standard, a missing description and bad names', () => {
    expect(skillFrontMatterSchema.safeParse({ ...valid, engine: 'claude' }).success).toBe(false);
    expect(skillFrontMatterSchema.safeParse({ name: 'support' }).success).toBe(false);
    expect(skillFrontMatterSchema.safeParse({ ...valid, description: ' ' }).success).toBe(false);
    expect(skillFrontMatterSchema.safeParse({ ...valid, name: 'Support' }).success).toBe(false);
    expect(skillFrontMatterSchema.safeParse({ ...valid, metadata: { n: 1 } }).success).toBe(false);
  });
});

describe('bot config', () => {
  const valid = {
    slug: 'support',
    displayName: 'Support',
    kind: 'office',
    engines: ['claude', 'codex'],
  };

  test('fills defaults for everything optional', () => {
    expect(botConfigSchema.parse(valid)).toEqual({
      ...valid,
      avatar: '',
      models: {},
      limits: { maxTurns: 30, maxRunMinutes: 30, maxParallelRuns: 1 },
      skills: [],
      enabled: true,
    });
  });

  test('takes models per tier, limits, effort and attached skills', () => {
    const parsed = botConfigSchema.parse({
      ...valid,
      models: { cheap_llm: 'haiku', frontier: 'opus' },
      effort: 'high',
      limits: { maxTurns: 10 },
      skills: ['release-playbook'],
      enabled: false,
    });
    expect(parsed).toMatchObject({
      models: { cheap_llm: 'haiku', frontier: 'opus' },
      effort: 'high',
      limits: { maxTurns: 10, maxRunMinutes: 30, maxParallelRuns: 1 },
      skills: ['release-playbook'],
      enabled: false,
    });
  });

  test.each([
    ['an unknown engine', { engines: ['gemini'] }],
    ['no engines', { engines: [] }],
    ['a repeated engine', { engines: ['claude', 'claude'] }],
    ['an unknown kind', { kind: 'boss' }],
    ['an unknown tier', { models: { rule: 'x' } }],
    ['a misspelled key', { displayname: 'x' }],
    ['a zero limit', { limits: { maxTurns: 0 } }],
    ['an unknown limit', { limits: { turns: 3 } }],
    ['a repeated skill', { skills: ['a', 'a'] }],
    ['a bad slug', { slug: 'Support' }],
    ['a blank display name', { displayName: ' ' }],
  ])('rejects %s', (_name, patch) => {
    expect(botConfigSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('bot index', () => {
  const summary = {
    id: newId('bot'),
    slug: 'support',
    displayName: 'Support',
    kind: 'office',
    engines: ['claude'],
    enabled: true,
    skillDigest: 'a'.repeat(64),
  };

  test('a summary has a bot id, a digest and an optional load error', () => {
    expect(botSummarySchema.parse(summary)).toEqual(summary);
    expect(botSummarySchema.parse({ ...summary, loadError: 'bot.yaml: kind: bad' }).loadError).toBe(
      'bot.yaml: kind: bad',
    );
    expect(botSummarySchema.safeParse({ ...summary, skillDigest: 'abc' }).success).toBe(false);
    expect(botSummarySchema.safeParse({ ...summary, id: 'support' }).success).toBe(false);
  });

  test('a detail carries config and skill, or nulls while the folder is broken', () => {
    const broken = {
      ...summary,
      config: null,
      skill: null,
      skillSource: 'quebrado',
      references: [],
    };
    expect(botDetailSchema.parse(broken)).toEqual(broken);
    // A server that does not send the raw text yet reads as no text.
    const { skillSource: _omitted, ...older } = broken;
    expect(botDetailSchema.parse(older).skillSource).toBeNull();
    const whole = {
      ...summary,
      config: botConfigSchema.parse({
        slug: 'support',
        displayName: 'Support',
        kind: 'office',
        engines: ['claude'],
      }),
      skill: { frontMatter: { name: 'support', description: 'Helps.' }, body: '# Support\n' },
      skillSource: '---\nname: support\ndescription: Helps.\n---\n# Support\n',
      references: ['references/faq.md'],
    };
    expect(botDetailSchema.parse(whole)).toEqual(whole);
  });

  test.each(['bot.created', 'bot.updated', 'bot.removed'])('registers %s', (type) => {
    const raw = {
      id: newId('event'),
      type,
      occurredAt: '2026-10-31T10:00:00.000Z',
      actor: { kind: 'system' },
      subject: { kind: 'bot', id: summary.id },
      payload: { slug: 'support' },
    };
    expect(parseEvent(raw)).toEqual(raw);
    expect(parseClientEvent(raw, vi.fn())?.type).toBe(type);
    expect(() => parseEvent({ ...raw, payload: { slug: 'x', extra: 1 } })).toThrow();
  });
});

describe('botConfigPatchSchema', () => {
  test('keeps only the fields the patch names, never filling in defaults', () => {
    expect(botConfigPatchSchema.parse({})).toEqual({});
    expect(botConfigPatchSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(botConfigPatchSchema.parse({ displayName: 'Novo' })).toEqual({ displayName: 'Novo' });
  });

  test('still checks what it is given, and refuses the slug and unknown keys', () => {
    expect(botConfigPatchSchema.safeParse({ engines: [] }).success).toBe(false);
    expect(botConfigPatchSchema.safeParse({ kind: 'nope' }).success).toBe(false);
    expect(botConfigPatchSchema.safeParse({ slug: 'outro' }).success).toBe(false);
    expect(botConfigPatchSchema.safeParse({ surprise: 1 }).success).toBe(false);
  });

  test('completes a nested value it is given with its own defaults', () => {
    expect(botConfigPatchSchema.parse({ limits: { maxTurns: 5 } })).toEqual({
      limits: { maxTurns: 5, maxRunMinutes: 30, maxParallelRuns: 1 },
    });
  });
});
