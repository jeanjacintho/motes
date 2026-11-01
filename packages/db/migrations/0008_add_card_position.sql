ALTER TABLE "cards" ADD COLUMN "position" text;
--> statement-breakpoint
-- Existing cards keep their creation order: a fixed-width number plus a non-zero last digit.
UPDATE "cards" SET "position" = lpad("number"::text, 11, '0') || '1';
--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "position" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "cards_column_position_idx" ON "cards" ("project_id","status","position") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "card_position_check" CHECK ("position" ~ '^[0-9A-Za-z]*[1-9A-Za-z]$');
