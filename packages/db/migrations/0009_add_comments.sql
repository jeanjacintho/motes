CREATE TABLE "comments" (
	"id" text PRIMARY KEY,
	"card_id" text NOT NULL,
	"author_type" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"edited_at" timestamp(3) with time zone,
	"deleted_at" timestamp(3) with time zone,
	CONSTRAINT "comment_author_check" CHECK ("author_type" IN ('owner', 'bot')),
	CONSTRAINT "comment_author_id_check" CHECK (length(trim("author_id")) > 0),
	CONSTRAINT "comment_body_check" CHECK (length(trim("body")) > 0)
);

--> statement-breakpoint
CREATE INDEX "comments_card_idx" ON "comments" ("card_id","created_at","id");
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id");
