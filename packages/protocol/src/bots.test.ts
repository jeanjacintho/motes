import { describe, expect, test } from 'vitest';
import { botConfigSchema, skillFrontMatterSchema, slugSchema } from './index.js';

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
