CREATE TABLE "projects" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"default_runtime_id" text,
	"created_at" timestamp(3) with time zone NOT NULL,
	"archived_at" timestamp(3) with time zone,
	CONSTRAINT "project_key_check" CHECK ("key" ~ '^[A-Z]{2,6}$'),
	CONSTRAINT "project_name_check" CHECK (length(trim("name")) > 0)
);

