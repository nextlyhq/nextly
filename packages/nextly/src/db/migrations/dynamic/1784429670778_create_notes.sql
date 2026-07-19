-- Create dynamic collection: dc_notes
CREATE TABLE IF NOT EXISTS "dc_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')) NOT NULL,
  "updated_at" integer DEFAULT (strftime('%s', 'now')) NOT NULL,
  "created_by" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dc_notes_created_at" ON "dc_notes"("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dc_notes_created_by" ON "dc_notes"("created_by");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_notes_slug" ON "dc_notes"("slug");