-- Migration: Create dynamic_singles table
-- This migration creates the dynamic_singles table for storing Singles (Globals) metadata
-- Singles are single-document entities for site-wide configuration (site settings, navigation, etc.)

CREATE TABLE IF NOT EXISTS "dynamic_singles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" varchar(255) NOT NULL,
	"label" varchar(255) NOT NULL,
	"table_name" varchar(255) NOT NULL,
	"description" text,
	"fields" jsonb NOT NULL,
	"admin" jsonb,
	"access_rules" jsonb,
	"source" varchar(20) DEFAULT 'ui' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"config_path" varchar(500),
	"schema_hash" varchar(64) NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"migration_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"last_migration_id" uuid,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_singles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "dynamic_singles_table_name_unique" UNIQUE("table_name")
);
--> statement-breakpoint

-- Create indexes for query performance
CREATE INDEX IF NOT EXISTS "dynamic_singles_source_idx" ON "dynamic_singles" USING btree ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dynamic_singles_migration_status_idx" ON "dynamic_singles" USING btree ("migration_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dynamic_singles_created_by_idx" ON "dynamic_singles" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dynamic_singles_created_at_idx" ON "dynamic_singles" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dynamic_singles_updated_at_idx" ON "dynamic_singles" USING btree ("updated_at");
