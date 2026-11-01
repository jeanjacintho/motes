CREATE TABLE "card_activity" (
	"id" text PRIMARY KEY,
	"seq" bigint NOT NULL,
	"card_id" text NOT NULL,
	"type" text NOT NULL,
	"actor" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp(3) with time zone NOT NULL
);

--> statement-breakpoint
CREATE INDEX "card_activity_card_idx" ON "card_activity" ("card_id","seq");
--> statement-breakpoint
ALTER TABLE "card_activity" ADD CONSTRAINT "card_activity_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id");
