CREATE TABLE "card_labels" (
	"card_id" text,
	"label_id" text,
	CONSTRAINT "card_labels_pkey" PRIMARY KEY("card_id","label_id")
);

--> statement-breakpoint
CREATE TABLE "labels" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "label_name_check" CHECK (length(trim("name")) > 0),
	CONSTRAINT "label_color_check" CHECK ("color" ~ '^#[0-9a-f]{6}$')
);

--> statement-breakpoint
CREATE UNIQUE INDEX "labels_project_name_idx" ON "labels" ("project_id",lower("name"));
--> statement-breakpoint
ALTER TABLE "card_labels" ADD CONSTRAINT "card_labels_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id");
--> statement-breakpoint
ALTER TABLE "card_labels" ADD CONSTRAINT "card_labels_label_id_labels_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id");
--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
