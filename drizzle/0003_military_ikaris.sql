CREATE TABLE IF NOT EXISTS "insights" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"tags" text[] NOT NULL,
	"taxonomy_version" integer NOT NULL,
	"headline" text NOT NULL,
	"volume_pct" double precision NOT NULL,
	"conversation_count" integer NOT NULL,
	"sentiment_avg" double precision NOT NULL,
	"weekly_volume" integer[] NOT NULL,
	"attributed_cause" jsonb,
	"marker_distribution" jsonb NOT NULL,
	"end_reason_distribution" jsonb NOT NULL,
	"example_conversation_ids" text[] NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insights" ADD CONSTRAINT "insights_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insights_tags_idx" ON "insights" USING gin ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insights_cluster_id_idx" ON "insights" USING btree ("cluster_id");