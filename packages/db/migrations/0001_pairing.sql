CREATE TABLE "device_tokens" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"created_at" timestamp(3) with time zone NOT NULL,
	"last_used_at" timestamp(3) with time zone,
	"revoked_at" timestamp(3) with time zone
);

--> statement-breakpoint
CREATE TABLE "pairing_state" (
	"id" integer PRIMARY KEY,
	"code_hash" text,
	"expires_at" timestamp(3) with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp(3) with time zone
);
