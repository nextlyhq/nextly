-- Migration: Create activity_log table for Dashboard Activity Feed (Plan 16)
-- This migration creates the activity_log table that records create/update/delete
-- actions across all collections for the dashboard activity feed.

-- UP

CREATE TABLE IF NOT EXISTS "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"user_name" text NOT NULL,
	"user_email" text NOT NULL,
	"action" text NOT NULL,
	"collection" text NOT NULL,
	"entry_id" text,
	"entry_title" text,
	"metadata" text,
	"created_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_activity_log_created_at" ON "activity_log" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_activity_log_collection" ON "activity_log" ("collection", "created_at");
CREATE INDEX IF NOT EXISTS "idx_activity_log_user_id" ON "activity_log" ("user_id", "created_at");

-- DOWN

DROP INDEX IF EXISTS "idx_activity_log_user_id";
DROP INDEX IF EXISTS "idx_activity_log_collection";
DROP INDEX IF EXISTS "idx_activity_log_created_at";
DROP TABLE IF EXISTS "activity_log";
