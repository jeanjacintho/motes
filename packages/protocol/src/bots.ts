import { z } from 'zod';

/** Folder names, bot slugs and skill names share one shape: lowercase words joined by hyphens. */
export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single hyphens');

/**
 * The front matter of a SKILL.md, limited to the standard agent-skill fields so every CLI can load
 * the file as is. Anything else is rejected: Motes settings belong in bot.yaml.
 */
export const skillFrontMatterSchema = z.strictObject({
  name: slugSchema,
  description: z.string().trim().min(1).max(1024),
  license: z.string().min(1).optional(),
  compatibility: z.string().min(1).max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  'allowed-tools': z.string().min(1).optional(),
});
export type SkillFrontMatter = z.infer<typeof skillFrontMatterSchema>;

export const BOT_KINDS = ['dev', 'office'] as const;
/** In order of the decision layer's tiers that call a model; the rule tier needs none. */
export const MODEL_TIERS = ['classifier', 'cheap_llm', 'frontier'] as const;
export const ENGINE_NAMES = ['claude', 'codex', 'opencode', 'cursor'] as const;
export const BOT_EFFORTS = ['low', 'medium', 'high'] as const;
export type BotKind = (typeof BOT_KINDS)[number];
export type EngineName = (typeof ENGINE_NAMES)[number];

const positiveInt = z.number().int().positive();

/**
 * The Motes side of a bot (bot.yaml). Strict on purpose: budget, triggers and tools join the
 * schema with their own cards, and a misspelled key should fail instead of being ignored.
 */
export const botConfigSchema = z.strictObject({
  /** Must equal the folder name; the loader checks that. */
  slug: slugSchema,
  displayName: z.string().trim().min(1).max(80),
  avatar: z.string().max(2048).default(''),
  kind: z.enum(BOT_KINDS),
  /** Engines in order of preference. */
  engines: z
    .array(z.enum(ENGINE_NAMES))
    .min(1)
    .refine((engines) => new Set(engines).size === engines.length, 'List each engine once'),
  models: z
    .strictObject(
      Object.fromEntries(MODEL_TIERS.map((tier) => [tier, z.string().min(1).optional()])),
    )
    .default({}),
  effort: z.enum(BOT_EFFORTS).optional(),
  limits: z
    .strictObject({
      maxTurns: positiveInt.default(30),
      maxRunMinutes: positiveInt.default(30),
      maxParallelRuns: positiveInt.default(1),
    })
    .default({ maxTurns: 30, maxRunMinutes: 30, maxParallelRuns: 1 }),
  /** Slugs of the shared skills attached to this bot. */
  skills: z
    .array(slugSchema)
    .refine((skills) => new Set(skills).size === skills.length, 'List each skill once')
    .default([]),
  enabled: z.boolean().default(true),
});
export type BotConfig = z.output<typeof botConfigSchema>;
