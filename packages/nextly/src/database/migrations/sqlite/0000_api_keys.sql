-- Migration: Create api_keys table for API Key Authentication (Plan 14)
-- This migration creates the api_keys table required for programmatic API access
-- using long-lived secret keys with SHA-256 hashed storage.

-- UP

CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"token_type" text NOT NULL,
	"role_id" text REFERENCES "roles"("id") ON DELETE SET NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"expires_at" integer,
	"last_used_at" integer,
	"is_active" integer NOT NULL DEFAULT 1,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_unique" ON "api_keys" ("key_hash");
CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys" ("user_id");
CREATE INDEX IF NOT EXISTS "api_keys_role_id_idx" ON "api_keys" ("role_id");
CREATE INDEX IF NOT EXISTS "api_keys_is_active_expires_at_idx" ON "api_keys" ("is_active", "expires_at");

-- DOWN

DROP INDEX IF EXISTS "api_keys_is_active_expires_at_idx";
DROP INDEX IF EXISTS "api_keys_role_id_idx";
DROP INDEX IF EXISTS "api_keys_user_id_idx";
DROP INDEX IF EXISTS "api_keys_key_hash_unique";
DROP TABLE IF EXISTS "api_keys";
