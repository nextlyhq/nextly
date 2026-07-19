-- Create dynamic collection: dc_articles
CREATE TABLE IF NOT EXISTS "dc_articles" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
"views" integer,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')) NOT NULL,
  "updated_at" integer DEFAULT (strftime('%s', 'now')) NOT NULL,
  "created_by" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dc_articles_created_at" ON "dc_articles"("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dc_articles_created_by" ON "dc_articles"("created_by");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_articles_slug" ON "dc_articles"("slug");

CREATE TABLE "dc_articles_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "heading" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_articles" ("id") ON DELETE CASCADE
);