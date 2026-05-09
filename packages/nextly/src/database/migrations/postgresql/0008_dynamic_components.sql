-- Migration: Create dynamic_components table
-- This migration creates the dynamic_components table for storing Component metadata
-- Components are reusable field group templates that can be embedded in Collections and Singles

CREATE TABLE IF NOT EXISTS "dynamic_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" varchar(255) NOT NULL,
	"label" varchar(255) NOT NULL,
	"table_name" varchar(255) NOT NULL,
	"description" text,
	"fields" jsonb NOT NULL,
	"admin" jsonb,
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
	CONSTRAINT "dynamic_components_slug_unique" UNIQUE("slug"),
	CONSTRAINT "dynamic_components_table_name_unique" UNIQUE("table_name")
);
--> statement-breakpoint

-- Create indexes for query performance
CREATE INDEX IF NOT EXISTS "dynamic_components_source_idx" ON "dynamic_components" USING btree ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dynamic_components_migration_status_idx" ON "dynamic_components" USING btree ("migration_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dynamic_components_created_by_idx" ON "dynamic_components" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dynamic_components_created_at_idx" ON "dynamic_components" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dynamic_components_updated_at_idx" ON "dynamic_components" USING btree ("updated_at");
