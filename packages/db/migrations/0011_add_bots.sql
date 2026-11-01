CREATE TABLE "bots" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"engines" jsonb NOT NULL,
	"enabled" boolean NOT NULL,
	"skill_digest" text NOT NULL,
	"load_error" text,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"removed_at" timestamp(3) with time zone,
	CONSTRAINT "bot_kind_check" CHECK ("kind" IN ('dev', 'office')),
	CONSTRAINT "bot_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "bot_digest_check" CHECK ("skill_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "bot_engines_check" CHECK (jsonb_typeof("engines") = 'array' AND jsonb_array_length("engines") > 0)
);

