-- Migration: Update dynamic_collections table schema
-- This migration updates the dynamic_collections table to the new schema format

-- Step 1: Add new columns
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "slug" varchar(100);
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "labels" jsonb;
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "fields" jsonb;
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "timestamps" boolean DEFAULT true NOT NULL;
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "admin" jsonb;
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'ui' NOT NULL;
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "locked" boolean DEFAULT false NOT NULL;
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "config_path" varchar(500);
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "schema_hash" varchar(64);
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "schema_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "migration_status" varchar(20) DEFAULT 'pending' NOT NULL;
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "last_migration_id" varchar(100);
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "access_rules" jsonb;
ALTER TABLE "dynamic_collections" ADD COLUMN IF NOT EXISTS "hooks" jsonb;
--> statement-breakpoint

-- Step 2: Migrate data from old columns to new columns
UPDATE "dynamic_collections"
SET
  "slug" = COALESCE("name", "id"),
  "labels" = jsonb_build_object('singular', COALESCE("label", "name"), 'plural', COALESCE("label", "name") || 's'),
  "fields" = COALESCE("schema_definition", '[]'::jsonb),
  "schema_hash" = md5("schema_definition"::text)
WHERE "slug" IS NULL;
--> statement-breakpoint

-- Step 3: Make required columns NOT NULL after data migration
ALTER TABLE "dynamic_collections" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "dynamic_collections" ALTER COLUMN "labels" SET NOT NULL;
ALTER TABLE "dynamic_collections" ALTER COLUMN "fields" SET NOT NULL;
ALTER TABLE "dynamic_collections" ALTER COLUMN "schema_hash" SET NOT NULL;
--> statement-breakpoint

-- Step 4: Add unique constraint on slug
CREATE UNIQUE INDEX IF NOT EXISTS "dynamic_collections_slug_unique" ON "dynamic_collections" USING btree ("slug");
--> statement-breakpoint

-- Step 5: Add source index
CREATE INDEX IF NOT EXISTS "dynamic_collections_source_idx" ON "dynamic_collections" USING btree ("source");
--> statement-breakpoint

-- Step 6: Drop old columns that are no longer needed
ALTER TABLE "dynamic_collections" DROP COLUMN IF EXISTS "name";
ALTER TABLE "dynamic_collections" DROP COLUMN IF EXISTS "label";
ALTER TABLE "dynamic_collections" DROP COLUMN IF EXISTS "icon";
ALTER TABLE "dynamic_collections" DROP COLUMN IF EXISTS "schema_definition";
