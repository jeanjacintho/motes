CREATE TABLE "events" (
	"seq" bigserial PRIMARY KEY,
	"id" text NOT NULL UNIQUE,
	"type" text NOT NULL,
	"occurred_at" timestamp(3) with time zone NOT NULL,
	"actor" jsonb NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"payload" jsonb NOT NULL
);

--> statement-breakpoint
-- Drizzle Kit generates the table above. This trigger is reviewed SQL:
-- PostgreSQL delivers NOTIFY only when the inserting transaction commits.
CREATE FUNCTION notify_motes_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('motes_events', NEW.seq::text);
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER events_notify
AFTER INSERT ON events
FOR EACH ROW EXECUTE FUNCTION notify_motes_event();
