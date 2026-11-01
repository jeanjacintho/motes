CREATE TABLE "repositories" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"remote_url" text NOT NULL,
	"default_branch" text NOT NULL,
	"is_primary" boolean NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "repository_name_check" CHECK (length(trim("name")) > 0)
);

--> statement-breakpoint
CREATE TABLE "repository_paths" (
	"repository_id" text,
	"runtime_id" text,
	"local_path" text NOT NULL,
	CONSTRAINT "repository_paths_pkey" PRIMARY KEY("repository_id","runtime_id"),
	CONSTRAINT "repository_path_check" CHECK ("local_path" ~ '^/')
);

--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_primary_idx" ON "repositories" ("project_id") WHERE "is_primary";
--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "repository_paths" ADD CONSTRAINT "repository_paths_repository_id_repositories_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id");
