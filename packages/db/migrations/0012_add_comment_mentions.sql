CREATE TABLE "comment_mentions" (
	"comment_id" text,
	"bot_id" text,
	"created_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "comment_mentions_pkey" PRIMARY KEY("comment_id","bot_id")
);

--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_id_comments_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id");
--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_bot_id_bots_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id");
