CREATE TABLE "cards" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"assignee_type" text,
	"assignee_id" text,
	"repository_id" text,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "cards_project_number_key" UNIQUE("project_id","number"),
	CONSTRAINT "card_number_check" CHECK ("number" > 0),
	CONSTRAINT "card_title_check" CHECK (length(trim("title")) > 0),
	CONSTRAINT "card_status_check" CHECK ("status" IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')),
	CONSTRAINT "card_priority_check" CHECK ("priority" IN ('none', 'low', 'medium', 'high', 'urgent')),
	CONSTRAINT "card_assignee_check" CHECK (("assignee_type" IS NULL AND "assignee_id" IS NULL) OR ("assignee_type" IS NOT NULL AND "assignee_type" IN ('owner', 'bot') AND "assignee_id" IS NOT NULL AND length(trim("assignee_id")) > 0)),
	CONSTRAINT "card_creator_check" CHECK ("created_by_type" IN ('owner', 'bot', 'system'))
);

--> statement-breakpoint
CREATE TABLE "project_counters" (
	"project_id" text PRIMARY KEY,
	"last_number" integer NOT NULL,
	CONSTRAINT "project_counter_check" CHECK ("last_number" >= 0)
);

--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_repository_id_repositories_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id");
--> statement-breakpoint
ALTER TABLE "project_counters" ADD CONSTRAINT "project_counters_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
