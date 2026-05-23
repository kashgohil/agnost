CREATE TABLE IF NOT EXISTS "turn_signals" (
	"turn_id" text PRIMARY KEY NOT NULL,
	"intent" text NOT NULL,
	"sentiment" double precision NOT NULL,
	"frustration_markers" text[] NOT NULL,
	"is_repeat" boolean NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "turn_signals" ADD CONSTRAINT "turn_signals_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_signals_intent_idx" ON "turn_signals" USING btree ("intent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_signals_frustration_markers_idx" ON "turn_signals" USING gin ("frustration_markers");