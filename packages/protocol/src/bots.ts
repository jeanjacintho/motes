import { z } from 'zod';
import { idSchema } from './ids.js';

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

/** A row of the bot index. The behavior itself stays in the folder on disk. */
export const botSummarySchema = z.object({
  id: idSchema('bot'),
  slug: slugSchema,
  displayName: z.string().min(1),
  kind: z.enum(BOT_KINDS),
  engines: z.array(z.enum(ENGINE_NAMES)),
  enabled: z.boolean(),
  /** Changes whenever SKILL.md, bot.yaml or a reference file changes. */
  skillDigest: z.string().regex(/^[0-9a-f]{64}$/),
  /** Set while the folder on disk is invalid; the fields above are then the last valid version. */
  loadError: z.string().optional(),
});
export type BotSummary = z.infer<typeof botSummarySchema>;

/** The index row plus what is read from disk; config and skill are null while the folder is broken. */
export const botDetailSchema = botSummarySchema.extend({
  config: botConfigSchema.nullable(),
  skill: z.object({ frontMatter: skillFrontMatterSchema, body: z.string() }).nullable(),
  /** SKILL.md exactly as on disk, which the editor needs; also set while the folder is broken. */
  skillSource: z.string().nullable().default(null),
  references: z.array(z.string()),
});
export type BotDetail = z.infer<typeof botDetailSchema>;

/**
 * Fields of bot.yaml a client may change; the slug is the folder name and never changes. Built
 * without the file schema's defaults: a field the patch does not name must stay absent, not be
 * filled in and written over what the file says. A nested value (`limits`, `models`) replaces the
 * whole value and is completed with its own defaults.
 */
const configShape = botConfigSchema.shape;
export const botConfigPatchSchema = z.strictObject({
  displayName: configShape.displayName.optional(),
  avatar: configShape.avatar.removeDefault().optional(),
  kind: configShape.kind.optional(),
  engines: configShape.engines.optional(),
  models: configShape.models.removeDefault().optional(),
  effort: configShape.effort,
  limits: configShape.limits.removeDefault().optional(),
  skills: configShape.skills.removeDefault().optional(),
  enabled: configShape.enabled.removeDefault().optional(),
});
export type BotConfigPatch = z.infer<typeof botConfigPatchSchema>;

/** A new SKILL.md, whole. It is validated like a file read from disk. */
export const putBotSkillBodySchema = z.object({
  skill: z
    .string()
    .min(1)
    .max(256 * 1024),
});
export type PutBotSkillBody = z.infer<typeof putBotSkillBodySchema>;

/** A new bot starts from a template with these values; the rest of bot.yaml takes its defaults. */
export const createBotInputSchema = z.object({
  slug: slugSchema,
  displayName: botConfigSchema.shape.displayName,
  kind: botConfigSchema.shape.kind,
  engines: botConfigSchema.shape.engines.default(['claude']),
  description: skillFrontMatterSchema.shape.description.optional(),
});
export type CreateBotInput = z.input<typeof createBotInputSchema>;

export const removeBotResponseSchema = z.object({ removed: z.boolean() });

/** One commit of a bot's folder in the skills repository, newest first. */
export const botHistoryEntrySchema = z.object({
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  message: z.string(),
  author: z.string(),
  committedAt: z.string(),
});
export type BotHistoryEntry = z.infer<typeof botHistoryEntrySchema>;

export const botHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const revertBotParamsSchema = z.object({
  id: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/, 'Expected a commit hash'),
});
