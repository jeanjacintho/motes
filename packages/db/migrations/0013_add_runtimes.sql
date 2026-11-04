CREATE TABLE "runtimes" (
	"id" text PRIMARY KEY,
	"device_id" text NOT NULL UNIQUE,
	"machine_name" text NOT NULL,
	"os" text NOT NULL,
	"engines" jsonb NOT NULL,
	"capacity" integer NOT NULL,
	"last_heartbeat_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "runtimes_capacity_check" CHECK ("capacity" BETWEEN 1 AND 64),
	CONSTRAINT "runtimes_machine_name_check" CHECK (length(trim("machine_name")) > 0)
);

--> statement-breakpoint
ALTER TABLE "runtimes" ADD CONSTRAINT "runtimes_device_id_device_tokens_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_tokens"("id");
