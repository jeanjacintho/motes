ALTER TABLE "device_tokens" ADD CONSTRAINT "device_kind_check" CHECK ("kind" IN ('client', 'daemon'));
--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_name_check" CHECK (length(trim("name")) > 0);
--> statement-breakpoint
ALTER TABLE "pairing_state" ADD CONSTRAINT "pairing_singleton_check" CHECK ("id" = 1);
--> statement-breakpoint
ALTER TABLE "pairing_state" ADD CONSTRAINT "pairing_failures_check" CHECK ("failures" BETWEEN 0 AND 4);
--> statement-breakpoint
ALTER TABLE "pairing_state" ADD CONSTRAINT "pairing_code_check" CHECK (("code_hash" IS NULL AND "expires_at" IS NULL) OR ("code_hash" IS NOT NULL AND "code_hash" ~ '^[0-9a-f]{64}$' AND "expires_at" IS NOT NULL));
