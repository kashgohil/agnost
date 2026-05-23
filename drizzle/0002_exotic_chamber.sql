CREATE TABLE IF NOT EXISTS "clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"member_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intents" (
	"intent" text PRIMARY KEY NOT NULL,
	"embedding" vector(1536),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"embedded_at" timestamp with time zone,
	"cluster_id" text,
	"probability" double precision,
	"clustered_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intents" ADD CONSTRAINT "intents_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intents_cluster_id_idx" ON "intents" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intents_embedding_idx" ON "intents" USING hnsw ("embedding" vector_cosine_ops);