CREATE TABLE IF NOT EXISTS "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"end_reason" text NOT NULL,
	"raw" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"turn_id" text NOT NULL,
	"tool_call_index" integer NOT NULL,
	"tool_name" text NOT NULL,
	"input_summary" text NOT NULL,
	"status" text NOT NULL,
	"output" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "turns" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"turn_index" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "turns" ADD CONSTRAINT "turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_started_at_idx" ON "conversations" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_agent_id_idx" ON "conversations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_calls_turn_idx" ON "tool_calls" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_calls_tool_name_status_idx" ON "tool_calls" USING btree ("tool_name","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turns_conversation_idx" ON "turns" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turns_role_idx" ON "turns" USING btree ("role");